-- =====================================================================================
-- 002 · Friends verify their email before submitting their quiz        (29 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- Changes: public.friend_submit now requires the friend to be signed in (with a sign-in code) as
-- the email they submit; their record becomes their own verified person record. Anonymous
-- visitors can no longer call it.
-- =====================================================================================

-- A friend submits their own details + quiz through the party link, after verifying their email
-- with a sign-in code (they must be signed in as the email they submit). Their record becomes
-- their own verified person record. Once complete it can't be overwritten through the link.
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
    age_range = private.clip(me ->> 'age', 10), gender = private.clip(me ->> 'gender', 20), gender_text = private.clip(me ->> 'genderText', 60),
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

revoke all on function public.friend_submit(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.friend_submit(text, text, jsonb) to authenticated;
