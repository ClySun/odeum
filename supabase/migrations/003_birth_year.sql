-- =====================================================================================
-- 003 · Birth year instead of an age range on "About you"                (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- Adds people.birth_year. The age range used for matching is now worked out from it; friends'
-- ages estimated by the organizer stay as ranges.
-- =====================================================================================

alter table private.people add column if not exists birth_year int check (birth_year between 1900 and 2100);

create or replace function private.birth_year(j jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when j ->> 'birthYear' ~ '^\d{4}$' and (j ->> 'birthYear')::int between 1900 and 2100 then (j ->> 'birthYear')::int end
$$;

create or replace function private.age_range_from_year(y int) returns text
language sql stable set search_path = '' as $$
  select case when y is null then null
              else (select case when a < 18 then null when a <= 21 then '18–21' when a <= 25 then '22–25'
                                when a <= 35 then '26–35' when a <= 40 then '36–40' else '41+' end
                    from (select extract(year from current_date)::int - y as a) t) end
$$;

create or replace function public.save_draft(p_id text, p_secret text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b jsonb := coalesce(p_data -> 'booking', '{}'); me jsonb := coalesce(p_data -> 'booking' -> 'me', '{}');
  v private.bookings; v_found boolean; friends jsonb; names jsonb; f jsonb; v_person uuid; v_fp uuid;
  v_email text := lower(private.clip(me ->> 'email', 200)); v_game text := coalesce(private.clip(b ->> 'game', 40), 'prague');
  v_quiz jsonb := case when jsonb_typeof(b -> 'quiz') = 'object' then b -> 'quiz' else '{}' end;
begin
  if p_id !~ '^[a-z0-9]{10,40}$' or length(coalesce(p_secret, '')) < 16 then raise exception 'bad_request'; end if;

  -- housekeeping: forget drafts nobody ever verified after 30 days, and people left with nothing
  delete from private.bookings where status = 'Draft' and owner is null and last_activity_at < now() - interval '30 days';
  delete from private.people p where p.email is null and p.user_id is null
    and not exists (select 1 from private.seats x where x.person_id = p.id)
    and not exists (select 1 from private.bookings k where k.organizer_id = p.id)
    and p.created_at < now() - interval '1 day';

  select * into v from private.bookings where id = p_id for update;
  v_found := found;
  if v_found then
    if not private.can_edit(v, p_secret) then raise exception 'forbidden'; end if;
    if v.status in ('Booked', 'Cancelled') then return jsonb_build_object('ok', true, 'locked', true); end if;
  end if;
  if not exists (select 1 from private.games where id = v_game and status = 'Open') then raise exception 'bad_request'; end if;

  friends := case when b ->> 'mode' = 'group' and jsonb_typeof(b -> 'friends') = 'array' then b -> 'friends' else '[]' end;
  if jsonb_array_length(friends) > (select seats from private.games where id = v_game) - 1 then raise exception 'too_many'; end if;
  names := jsonb_build_object('me', me ->> 'name') ||
           coalesce((select jsonb_object_agg(x ->> 'id', x ->> 'name') from jsonb_array_elements(friends) x), '{}');

  -- organizer's person record
  v_person := case when v_found then v.organizer_id end;
  if v_person is null then
    insert into private.people (contact_email) values (v_email) returning id into v_person;
  end if;
  update private.people set name = private.clip(me ->> 'name'), contact_email = v_email, phone = private.clip(me ->> 'phone', 40),
    birth_year = private.birth_year(me),
    age_range = coalesce(private.age_range_from_year(private.birth_year(me)), private.clip(me ->> 'age', 10)),
    gender = private.clip(me ->> 'gender', 20), gender_text = private.clip(me ->> 'genderText', 60),
    newsletter_opt_in_at = case when (me ->> 'newsletter')::boolean then coalesce(newsletter_opt_in_at, now()) when me ? 'newsletter' then null else newsletter_opt_in_at end,
    sms_opt_in_at = case when (me ->> 'sms')::boolean then coalesce(sms_opt_in_at, now()) when me ? 'sms' then null else sms_opt_in_at end,
    updated_at = now()
  where id = v_person;

  insert into private.bookings as t (id, draft_secret_hash, organizer_id, email, party_token, game_id, join_session_id, group_size,
      real_life_couples, character_prefs, special_requests, last_activity_at, updated_at)
  values (p_id, private.hash(p_secret), v_person, v_email,
      case when b ->> 'partyToken' ~ '^[a-z0-9]{12,40}$' then b ->> 'partyToken' end, v_game,
      case when (b ->> 'joining')::boolean then (select s.id from private.sessions s where s.id::text = b ->> 'joinSession' and s.game_id = v_game) end,
      1 + jsonb_array_length(friends),
      coalesce((select jsonb_agg(jsonb_build_array(names ->> (c ->> 0), names ->> (c ->> 1)))
                from jsonb_array_elements(case when jsonb_typeof(b -> 'couples') = 'array' then b -> 'couples' else '[]' end) c
                where names ? (c ->> 0) and names ? (c ->> 1)), '[]'),
      case when (b ->> 'prefsOn')::boolean then
        coalesce((select jsonb_agg(jsonb_build_object('member', k, 'who', names ->> k, 'choice', pv ->> 'choice',
                                                      'strength', coalesce(pv ->> 'strength', 'preferred')))
                  from jsonb_each(case when jsonb_typeof(b -> 'prefs') = 'object' then b -> 'prefs' else '{}' end) as e(k, pv)
                  where names ? k and coalesce(pv ->> 'choice', 'none') <> 'none'), '[]')
      else '[]' end,
      private.clip(b ->> 'requests', 2000), now(), now())
  on conflict (id) do update set
      email = excluded.email, party_token = excluded.party_token, join_session_id = excluded.join_session_id,
      group_size = excluded.group_size, real_life_couples = excluded.real_life_couples, character_prefs = excluded.character_prefs,
      special_requests = excluded.special_requests, last_activity_at = now(), updated_at = now(),
      -- a changed email must be verified again
      email_verified_at = case when excluded.email = t.email then t.email_verified_at end;

  -- organizer's quiz result (overwritten on retake) + seat
  if v_quiz <> '{}' then
    insert into private.quiz_results (person_id, game_id, answers, scores, top_match, updated_at)
    values (v_person, v_game, v_quiz, coalesce(p_data -> 'scores', '{}'), private.clip(p_data ->> 'topMatch', 40), now())
    on conflict (person_id, game_id) do update set answers = excluded.answers, scores = excluded.scores,
      top_match = excluded.top_match, updated_at = now();
  end if;
  insert into private.seats as x (id, booking_id, member_id, person_id, role, character_gender, scores, top_matches, special_requests, quiz_status, updated_at)
  values (p_id || '-me', p_id, 'me', v_person, 'Organizer',
      case when b ->> 'charGender' in ('male', 'female') and coalesce(me ->> 'gender', '') not in ('man', 'woman') then b ->> 'charGender' end,
      case when v_quiz <> '{}' then p_data -> 'scores' end, private.clip(p_data ->> 'topMatches'), private.clip(b ->> 'requests', 2000),
      case when v_quiz <> '{}' then 'Complete' else 'In progress' end, now())
  on conflict (id) do update set person_id = excluded.person_id, character_gender = excluded.character_gender, scores = excluded.scores,
      top_matches = excluded.top_matches, special_requests = excluded.special_requests, quiz_status = excluded.quiz_status, updated_at = now();

  -- the browser doesn't keep comfort answers, so only touch them when they're actually sent
  if b ? 'comfort' then
    insert into private.pairing_comfort (seat_id, comfort, updated_at) values (p_id || '-me', private.comfort_array(b -> 'comfort'), now())
    on conflict (seat_id) do update set comfort = excluded.comfort, updated_at = now();
  end if;

  -- friends: basics only; each answers the rest through the party link
  for f in select * from jsonb_array_elements(friends) loop
    if coalesce(f ->> 'id', '') !~ '^[a-z0-9]{4,20}$' then continue; end if;
    v_fp := null;
    select x.person_id into v_fp from private.seats x where x.id = p_id || '-' || (f ->> 'id');
    if v_fp is null then
      insert into private.people (name) values (null) returning id into v_fp;
      insert into private.seats (id, booking_id, member_id, person_id, role) values (p_id || '-' || (f ->> 'id'), p_id, f ->> 'id', v_fp, 'Friend')
      on conflict (id) do update set person_id = excluded.person_id;
    end if;
    update private.seats set quiz_status = case when quiz_status = 'Removed' then 'Not started' else quiz_status end, updated_at = now()
    where id = p_id || '-' || (f ->> 'id');
    update private.people set name = private.clip(f ->> 'name'), age_range = private.clip(f ->> 'age', 10),
      gender = private.clip(f ->> 'gender', 20), gender_text = private.clip(f ->> 'genderText', 60), updated_at = now()
    where id = v_fp and email is null
      and not exists (select 1 from private.seats x where x.id = p_id || '-' || (f ->> 'id') and x.quiz_status = 'Complete');
  end loop;
  update private.seats set quiz_status = 'Removed', updated_at = now()
  where booking_id = p_id and role = 'Friend' and member_id not in (select x ->> 'id' from jsonb_array_elements(friends) x);

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.friend_submit(p_token text, p_member_id text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_booking private.bookings; v_seat private.seats; me jsonb := coalesce(p_data -> 'me', '{}');
        v_quiz jsonb := case when jsonb_typeof(p_data -> 'quiz') = 'object' then p_data -> 'quiz' else '{}' end;
        v_email text := private.signed_in_email(); v_me uuid;
begin
  if auth.uid() is null or v_email is null then raise exception 'not_signed_in'; end if;
  if lower(private.clip(me ->> 'email', 200)) is distinct from v_email then return jsonb_build_object('ok', false, 'error', 'email_mismatch'); end if;
  select * into v_booking from private.bookings b
  where length(coalesce(p_token, '')) >= 12 and b.party_token = p_token and b.status = 'Booked';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into v_seat from private.seats x
  where x.booking_id = v_booking.id and x.member_id = p_member_id and x.role = 'Friend' and x.quiz_status not in ('Removed', 'Complete')
  for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_me := private.ensure_person();
  perform private.merge_person(v_seat.person_id, v_me);   -- the placeholder the organizer created becomes theirs
  update private.seats set person_id = v_me where id = v_seat.id;
  update private.people set name = private.clip(me ->> 'name'), phone = private.clip(me ->> 'phone', 40),
    birth_year = coalesce(private.birth_year(me), birth_year),
    age_range = coalesce(private.age_range_from_year(private.birth_year(me)), private.clip(me ->> 'age', 10)),
    gender = private.clip(me ->> 'gender', 20), gender_text = private.clip(me ->> 'genderText', 60),
    newsletter_opt_in_at = case when (me ->> 'newsletter')::boolean then coalesce(newsletter_opt_in_at, now()) when me ? 'newsletter' then null else newsletter_opt_in_at end,
    sms_opt_in_at = case when (me ->> 'sms')::boolean then coalesce(sms_opt_in_at, now()) when me ? 'sms' then null else sms_opt_in_at end,
    updated_at = now()
  where id = v_me;
  if v_quiz <> '{}' then
    insert into private.quiz_results (person_id, game_id, answers, scores, top_match, updated_at)
    values (v_me, v_booking.game_id, v_quiz, coalesce(p_data -> 'scores', '{}'), private.clip(p_data ->> 'topMatch', 40), now())
    on conflict (person_id, game_id) do update set answers = excluded.answers, scores = excluded.scores, top_match = excluded.top_match, updated_at = now();
  end if;
  update private.seats set character_gender = case when p_data ->> 'charGender' in ('male', 'female') and coalesce(me ->> 'gender', '') not in ('man', 'woman')
                                                     then p_data ->> 'charGender' end,
    scores = p_data -> 'scores', top_matches = private.clip(p_data ->> 'topMatches'),
    special_requests = private.clip(p_data ->> 'requests', 2000), quiz_status = 'Complete', updated_at = now()
  where id = v_seat.id;
  insert into private.pairing_comfort (seat_id, comfort, updated_at) values (v_seat.id, private.comfort_array(p_data -> 'comfort'), now())
  on conflict (seat_id) do update set comfort = excluded.comfort, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.update_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.ensure_person();
begin
  update private.people set name = private.clip(p ->> 'name'), phone = private.clip(p ->> 'phone', 40),
    birth_year = coalesce(private.birth_year(p), birth_year),
    age_range = coalesce(private.age_range_from_year(private.birth_year(p)), private.clip(p ->> 'age', 10), age_range),
    gender = private.clip(p ->> 'gender', 20), gender_text = private.clip(p ->> 'genderText', 60),
    newsletter_opt_in_at = case when p ? 'newsletter' then case when (p ->> 'newsletter')::boolean then coalesce(newsletter_opt_in_at, now()) end else newsletter_opt_in_at end,
    sms_opt_in_at = case when p ? 'sms' then case when (p ->> 'sms')::boolean then coalesce(sms_opt_in_at, now()) end else sms_opt_in_at end,
    updated_at = now()
  where id = v_me;
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
          'isOrganizer', b.organizer_id = v_me,
          'partyToken', case when b.organizer_id = v_me then b.party_token end,
          'topMatches', me.top_matches, 'requests', me.special_requests, 'character', me.assigned_character,
          'comfort', (select to_jsonb(c.comfort) from private.pairing_comfort c where c.seat_id = me.id),
          'party', (select jsonb_agg(jsonb_build_object('name', split_part(coalesce(p.name, ''), ' ', 1), 'done', x.quiz_status = 'Complete',
                                                        'you', x.id = me.id, 'organizer', x.role = 'Organizer') order by x.role desc, p.name)
                    from private.seats x left join private.people p on p.id = x.person_id
                    where x.booking_id = b.id and x.quiz_status <> 'Removed')) as x
        from private.seats me join private.bookings b on b.id = me.booking_id left join private.sessions s on s.id = b.session_id
        where me.person_id = v_me and me.quiz_status <> 'Removed' and b.status in ('Booked', 'Cancelled')) q), '[]'));
end $$;

revoke all on function private.birth_year(jsonb), private.age_range_from_year(int) from public, anon, authenticated;
