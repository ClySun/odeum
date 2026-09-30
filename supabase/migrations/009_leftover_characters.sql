-- =====================================================================================
-- 009 · Leftover characters when a table fills; gender room per table   (30 Sep 2026, revised)
-- Paste into Supabase → SQL Editor → Run (after 007 and 008).  Safe to run more than once, and
-- safe to run over the earlier version of 009.
--  · A friend who has done their quiz keeps the character they were given then.
--  · When a table becomes full, anyone still without a character (hasn't done their quiz) is
--    given one of the characters left for their gender.
--  · availability: each table reports how many more male / female players it can take, so the
--    gender question can grey out a gender with nothing left.
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

create or replace function private.fill_leftovers(p_session uuid) returns void
language plpgsql set search_path = '' as $$
declare v_cap int; v_taken int; r record; v_char text;
begin
  select coalesce(s.seats, g.seats) into v_cap from private.sessions s join private.games g on g.id = s.game_id where s.id = p_session;
  select count(*) into v_taken from private.table_seats(p_session, null);
  if v_taken < v_cap then return; end if;
  for r in select t.seat_id, t.need from private.table_seats(p_session, null) t
           join private.seats x on x.id = t.seat_id join private.bookings b on b.id = x.booking_id
           where t.assigned is null order by b.booked_at nulls last, x.id loop
    select ch.id into v_char from private.characters ch join private.sessions s on s.game_id = ch.game_id
    where s.id = p_session and (r.need = 'any' or ch.gender = r.need)
      and ch.id not in (select t.assigned from private.table_seats(p_session, null) t where t.assigned is not null)
    order by ch.sort limit 1;
    if v_char is not null then update private.seats set assigned_character = v_char, updated_at = now() where id = r.seat_id; end if;
  end loop;
end $$;

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

create or replace function public.book(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; e jsonb;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v from private.bookings where id = p_id for update;
  if not found or v.owner is distinct from auth.uid() or v.email_verified_at is null or v.email is distinct from private.signed_in_email() then
    return jsonb_build_object('ok', false, 'error', 'unverified');
  end if;
  if v.status = 'Booked' then return jsonb_build_object('ok', true); end if;
  if v.status <> 'Held' or v.session_id is null then return jsonb_build_object('ok', false, 'error', 'no_table'); end if;
  if v.hold_expires_at <= now() then
    perform pg_advisory_xact_lock(hashtext(v.session_id::text));
    if not exists (select 1 from private.sessions where id = v.session_id and status = 'Open' and night > current_date) then
      return jsonb_build_object('ok', false, 'error', 'full');
    end if;
    e := private.evaluate(p_id, v.session_id);
    if not private.bookable(e) then return jsonb_build_object('ok', false, 'error', 'full'); end if;
    perform private.assign_organizer(p_id, e);   -- the hold lapsed, so their character may have moved
  end if;
  update private.seats x set assigned_character = r ->> 'choice'
  from jsonb_array_elements(v.character_prefs) r
  where x.booking_id = p_id and x.member_id = r ->> 'member' and x.member_id <> 'me'
    and r ->> 'choice' not in ('anyF', 'anyM', 'none')
    and not exists (select 1 from private.table_seats(v.session_id, p_id) t where t.assigned = r ->> 'choice');
  -- flag friends (by the optional email) who already have a seat that night
  update private.seats x set admin_note = 'Also booked in booking ' || other.booking_id
  from private.people fp,
       lateral (select x2.booking_id from private.seats x2 join private.bookings b2 on b2.id = x2.booking_id
                join private.people p2 on p2.id = x2.person_id
                join private.sessions s2 on s2.id = b2.session_id
                where b2.id <> p_id and b2.status = 'Booked' and x2.quiz_status <> 'Removed'
                  and s2.night = (select night from private.sessions where id = v.session_id)
                  and fp.contact_email is not null and lower(fp.contact_email) in (p2.email, lower(p2.contact_email))
                limit 1) other
  where x.booking_id = p_id and x.role = 'Friend' and fp.id = x.person_id;
  update private.bookings set status = 'Booked', hold_expires_at = null, booked_at = now(), updated_at = now() where id = p_id;
  perform private.fill_leftovers(v.session_id);   -- if this booking filled the table
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.portal_add_person(p_id text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; v_me uuid := private.ensure_person(); v_left int; v_person uuid; v_member text;
begin
  select * into v from private.bookings where id = p_id and organizer_id = v_me and status = 'Booked' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if private.clip(p ->> 'name') is null or private.clip(p ->> 'age', 10) is null or private.clip(p ->> 'gender', 20) is null then
    return jsonb_build_object('ok', false, 'error', 'missing_fields');
  end if;
  perform pg_advisory_xact_lock(hashtext(v.session_id::text));
  select coalesce(s.seats, g.seats) - (select count(*) from private.table_seats(s.id, null)) into v_left
  from private.sessions s join private.games g on g.id = s.game_id where s.id = v.session_id and s.night > current_date;
  if coalesce(v_left, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'full'); end if;
  insert into private.people (name, age_range, gender, gender_text, contact_email)
  values (private.clip(p ->> 'name'), private.clip(p ->> 'age', 10), private.clip(p ->> 'gender', 20),
          private.clip(p ->> 'genderText', 60), lower(private.clip(p ->> 'email', 200)))
  returning id into v_person;
  v_member := 'p' || substr(md5(random()::text || clock_timestamp()::text), 1, 10);
  insert into private.seats (id, booking_id, member_id, person_id, role) values (p_id || '-' || v_member, p_id, v_member, v_person, 'Friend');
  update private.bookings set group_size = group_size + 1, updated_at = now() where id = p_id;
  perform private.fill_leftovers(v.session_id);   -- if this seat filled the table
  return jsonb_build_object('ok', true);
end $$;

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
          'topMatches', me.top_matches, 'requests', me.special_requests, 'character', me.assigned_character,
          'comfort', (select to_jsonb(c.comfort) from private.pairing_comfort c where c.seat_id = me.id),
          'party', (select jsonb_agg(jsonb_build_object('name', split_part(coalesce(p.name, ''), ' ', 1), 'done', x.quiz_status = 'Complete',
                                                        'you', x.id = me.id, 'organizer', x.role = 'Organizer', 'member', x.member_id) order by x.role desc, p.name)
                    from private.seats x left join private.people p on p.id = x.person_id
                    where x.booking_id = b.id and x.quiz_status <> 'Removed')) as x
        from private.seats me join private.bookings b on b.id = me.booking_id left join private.sessions s on s.id = b.session_id
        where me.person_id = v_me and me.quiz_status <> 'Removed' and b.status in ('Booked', 'Cancelled')) q), '[]'));
end $$;

revoke all on function private.gender_room(uuid), private.fill_leftovers(uuid) from public, anon, authenticated;
