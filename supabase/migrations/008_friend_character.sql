-- =====================================================================================
-- 008 · Friends get the best character still open at their table          (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run (after 007).  Safe to run more than once.
--  · friend_options: what a friend can still play at their table (for their quiz page)
--  · friend_submit: assigns the best-fitting open character when they finish, and returns it
-- =====================================================================================

create or replace function public.friend_options(p_token text, p_member text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare b private.bookings; x private.seats; v_free text[]; v_need_m int; v_need_f int; v_free_m int; v_free_f int;
begin
  select * into b from private.bookings k where length(coalesce(p_token, '')) >= 12 and k.party_token = p_token and k.status = 'Booked';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into x from private.seats s where s.booking_id = b.id and s.member_id = p_member and s.role = 'Friend' and s.quiz_status <> 'Removed';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select array_agg(ch.id order by ch.sort) into v_free from private.characters ch
  where ch.game_id = b.game_id
    and ch.id not in (select t.assigned from private.table_seats(b.session_id, null) t where t.assigned is not null and t.seat_id <> x.id);
  v_free := coalesce(v_free, '{}');
  select count(*) filter (where t.need = 'male'), count(*) filter (where t.need = 'female') into v_need_m, v_need_f
  from private.table_seats(b.session_id, null) t where t.assigned is null and t.seat_id <> x.id;
  select count(*) filter (where ch.gender = 'male'), count(*) filter (where ch.gender = 'female') into v_free_m, v_free_f
  from private.characters ch where ch.game_id = b.game_id and ch.id = any (v_free);
  return jsonb_build_object('ok', true, 'assigned', x.assigned_character, 'open', to_jsonb(v_free),
    'canPlay', jsonb_build_object('male', v_free_m - v_need_m > 0, 'female', v_free_f - v_need_f > 0));
end $$;

create or replace function public.friend_submit(p_token text, p_member_id text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_booking private.bookings; v_seat private.seats; me jsonb := coalesce(p_data -> 'me', '{}');
        v_quiz jsonb := case when jsonb_typeof(p_data -> 'quiz') = 'object' then p_data -> 'quiz' else '{}' end;
        v_email text := private.signed_in_email(); v_me uuid; v_other text; v_char text; v_want text;
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

  -- their character: fixed already (plus-one / picked for them), else the best fit still open at the table
  v_char := v_seat.assigned_character;
  if v_char is null then
    v_want := case when p_data ->> 'charGender' in ('male', 'female') then p_data ->> 'charGender'
                   when me ->> 'gender' = 'man' then 'male' when me ->> 'gender' = 'woman' then 'female' end;
    select ch.id into v_char from private.characters ch
    where ch.game_id = v_booking.game_id and (v_want is null or ch.gender = v_want)
      and ch.id not in (select t.assigned from private.table_seats(v_booking.session_id, null) t
                        where t.assigned is not null and t.seat_id <> v_seat.id)
    order by (p_data -> 'scores' ->> ch.id)::numeric desc nulls last, ch.sort limit 1;
    update private.seats set assigned_character = v_char where id = v_seat.id;
  end if;

  -- already holding a seat that night in another booking? tell them and flag it for the team
  select x2.booking_id into v_other from private.seats x2 join private.bookings b2 on b2.id = x2.booking_id
  join private.sessions s2 on s2.id = b2.session_id
  where x2.person_id = v_me and x2.id <> v_seat.id and x2.quiz_status <> 'Removed' and b2.status = 'Booked'
    and s2.night = (select night from private.sessions where id = v_booking.session_id) limit 1;
  if v_other is not null then
    update private.seats set admin_note = 'Also booked in booking ' || v_other where id = v_seat.id;
    return jsonb_build_object('ok', true, 'warning', 'already_booked', 'character', v_char);
  end if;
  return jsonb_build_object('ok', true, 'character', v_char);
end $$;

revoke all on function public.friend_options(text, text) from public, anon, authenticated;
grant execute on function public.friend_options(text, text) to anon, authenticated;
