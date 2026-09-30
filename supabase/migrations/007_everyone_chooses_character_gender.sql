-- =====================================================================================
-- 007 · Everyone chooses which gender of character to play               (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- The quiz now asks every player; their answer is saved for everyone (before, only for
-- nonbinary / self-described players). Someone who hasn't answered plays their own gender.
-- =====================================================================================

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
      real_life_couples, character_prefs, special_requests, plus_one, last_activity_at, updated_at)
  values (p_id, private.hash(p_secret), v_person, v_email,
      case when b ->> 'partyToken' ~ '^[a-z0-9]{12,40}$' then b ->> 'partyToken' end, v_game,
      case when (b ->> 'joining')::boolean then (select s.id from private.sessions s where s.id::text = b ->> 'joinSession' and s.game_id = v_game) end,
      1 + jsonb_array_length(friends),
      coalesce((select jsonb_agg(jsonb_build_array(names ->> (c ->> 0), names ->> (c ->> 1)))
                from jsonb_array_elements(case when jsonb_typeof(b -> 'couples') = 'array' then b -> 'couples' else '[]' end) c
                where names ? (c ->> 0) and names ? (c ->> 1)), '[]'),
      case when (b ->> 'prefsOn')::boolean then
        coalesce((select jsonb_agg(jsonb_build_object('member', k, 'who', names ->> k, 'choice', pv ->> 'choice',
                                                      'strength', 'required'))  -- any pick is a requirement
                  from jsonb_each(case when jsonb_typeof(b -> 'prefs') = 'object' then b -> 'prefs' else '{}' end) as e(k, pv)
                  where names ? k and coalesce(pv ->> 'choice', 'none') <> 'none'), '[]')
      else '[]' end,
      private.clip(b ->> 'requests', 2000), coalesce((b ->> 'plusOne')::boolean, false), now(), now())
  on conflict (id) do update set
      email = excluded.email, party_token = excluded.party_token, join_session_id = excluded.join_session_id, plus_one = excluded.plus_one,
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
      case when b ->> 'charGender' in ('male', 'female') then b ->> 'charGender' end,   -- anyone may play either gender
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
      gender = private.clip(f ->> 'gender', 20), gender_text = private.clip(f ->> 'genderText', 60),
      contact_email = coalesce(lower(private.clip(f ->> 'email', 200)), contact_email), updated_at = now()
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
        v_email text := private.signed_in_email(); v_me uuid; v_other text;
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
  update private.seats set character_gender = case when p_data ->> 'charGender' in ('male', 'female') then p_data ->> 'charGender' end,
    scores = p_data -> 'scores', top_matches = private.clip(p_data ->> 'topMatches'),
    special_requests = private.clip(p_data ->> 'requests', 2000), quiz_status = 'Complete', updated_at = now()
  where id = v_seat.id;
  insert into private.pairing_comfort (seat_id, comfort, updated_at) values (v_seat.id, private.comfort_array(p_data -> 'comfort'), now())
  on conflict (seat_id) do update set comfort = excluded.comfort, updated_at = now();

  -- already holding a seat that night in another booking? tell them and flag it for the team
  select x2.booking_id into v_other from private.seats x2 join private.bookings b2 on b2.id = x2.booking_id
  join private.sessions s2 on s2.id = b2.session_id
  where x2.person_id = v_me and x2.id <> v_seat.id and x2.quiz_status <> 'Removed' and b2.status = 'Booked'
    and s2.night = (select night from private.sessions where id = v_booking.session_id) limit 1;
  if v_other is not null then
    update private.seats set admin_note = 'Also booked in booking ' || v_other where id = v_seat.id;
    return jsonb_build_object('ok', true, 'warning', 'already_booked');
  end if;
  return jsonb_build_object('ok', true);
end $$;
