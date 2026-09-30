-- =====================================================================================
-- 009 · Friends learn their character when the table is full; gender room per table  (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run (after 007 and 008).  Safe to run more than once.
--  · my_portal: a friend's character is shown only once their table is full
--  · availability: each table reports how many more male / female players it can take, so the
--    "joining friends" gender question can grey out a gender with nothing left
-- =====================================================================================

create or replace function private.gender_room(p_session uuid) returns jsonb
language sql stable set search_path = '' as $$
  with free as (
    select ch.gender from private.characters ch join private.sessions s on s.game_id = ch.game_id
    where s.id = p_session
      and ch.id not in (select t.assigned from private.table_seats(p_session, null) t where t.assigned is not null)
  ), waiting as (
    select t.need from private.table_seats(p_session, null) t where t.assigned is null
  )
  select jsonb_build_object(
    'male',   (select count(*) from free where gender = 'male')   - (select count(*) from waiting where need = 'male'),
    'female', (select count(*) from free where gender = 'female') - (select count(*) from waiting where need = 'female'))
$$;

create or replace function public.availability(p_game text default 'prague') returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'v', 3, 'sessions', coalesce(jsonb_agg(t.x order by t.x ->> 'date', t.x ->> 'id'), '[]'))
  from (
    select jsonb_build_object('id', s.id, 'date', to_char(s.night, 'YYYY-MM-DD'),
             'time', coalesce(nullif(s.time_label, ''), g.time_label), 'area', coalesce(nullif(s.area, ''), g.area),
             'seats', coalesce(s.seats, g.seats),
             'seatsLeft', greatest(coalesce(s.seats, g.seats) - (select count(*) from private.table_seats(s.id, null)), 0),
             'started', exists (select 1 from private.table_seats(s.id, null)),
             'room', private.gender_room(s.id)) as x
    from private.sessions s join private.games g on g.id = s.game_id
    where s.game_id = p_game and s.status = 'Open' and s.night > current_date
  ) t
$$;

create or replace function public.my_portal() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.ensure_person();
begin
  return jsonb_build_object('ok', true,
    'email', (select email from private.people where id = v_me),
    'profile', (select jsonb_build_object('name', name, 'phone', phone, 'age', age_range, 'birthYear', birth_year, 'gender', gender, 'genderText', gender_text,
                                          'newsletter', newsletter_opt_in_at is not null, 'sms', sms_opt_in_at is not null)
                from private.people where id = v_me),
    'bookings', coalesce((
      select jsonb_agg(q.x order by q.x ->> 'date') from (
        select jsonb_build_object('id', b.id, 'game', b.game_id, 'status', b.status,
          'date', to_char(s.night, 'YYYY-MM-DD'), 'label', private.night_label(b.session_id),
          'isOrganizer', b.organizer_id = v_me, 'plusOne', b.plus_one,
          'upcoming', s.night > current_date,
          'seatsLeft', case when b.organizer_id = v_me then
                         greatest(coalesce(s.seats, (select g.seats from private.games g where g.id = b.game_id))
                                  - (select count(*) from private.table_seats(b.session_id, null)), 0) end,
          'partyToken', case when b.organizer_id = v_me then b.party_token end,
          'topMatches', me.top_matches, 'requests', me.special_requests,
          -- friends find out their character once the table is full; organizers see theirs at booking
          'character', case when me.role = 'Organizer'
                              or (select count(*) from private.table_seats(b.session_id, null))
                                 >= coalesce(s.seats, (select g.seats from private.games g where g.id = b.game_id))
                            then me.assigned_character end,
          'comfort', (select to_jsonb(c.comfort) from private.pairing_comfort c where c.seat_id = me.id),
          'party', (select jsonb_agg(jsonb_build_object('name', split_part(coalesce(p.name, ''), ' ', 1), 'done', x.quiz_status = 'Complete',
                                                        'you', x.id = me.id, 'organizer', x.role = 'Organizer', 'member', x.member_id) order by x.role desc, p.name)
                    from private.seats x left join private.people p on p.id = x.person_id
                    where x.booking_id = b.id and x.quiz_status <> 'Removed')) as x
        from private.seats me join private.bookings b on b.id = me.booking_id left join private.sessions s on s.id = b.session_id
        where me.person_id = v_me and me.quiz_status <> 'Removed' and b.status in ('Booked', 'Cancelled')) q), '[]'));
end $$;

revoke all on function private.gender_room(uuid) from public, anon, authenticated;
