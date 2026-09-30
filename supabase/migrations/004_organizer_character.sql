-- =====================================================================================
-- 004 · Reserve the organizer's character when they pick a table          (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- Picking a table now reserves the organizer's best-fitting open character there (or the one they
-- required), so the site can say which character they'll play. It's released if the hold lapses.
-- =====================================================================================

create or replace function private.assign_organizer(p_id text, e jsonb) returns text
language plpgsql set search_path = '' as $$
declare v_req text; v_char text;
begin
  select r ->> 'choice' into v_req from private.bookings b, jsonb_array_elements(b.character_prefs) r
  where b.id = p_id and r ->> 'member' = 'me' and r ->> 'strength' = 'required' and r ->> 'choice' not in ('anyF', 'anyM', 'none') limit 1;
  v_char := coalesce(v_req, e ->> 'bestCharacter');
  update private.seats set assigned_character = v_char, updated_at = now() where id = p_id || '-me';
  return v_char;
end $$;

create or replace function public.hold_table(p_id text, p_secret text, p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; e jsonb;
begin
  select * into v from private.bookings where id = p_id for update;
  if not found or not private.can_edit(v, p_secret) then raise exception 'forbidden'; end if;
  if v.status in ('Booked', 'Cancelled') then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not exists (select 1 from private.sessions where id = p_session and game_id = v.game_id and status = 'Open' and night > current_date) then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_session::text));
  e := private.evaluate(p_id, p_session);
  if not private.bookable(e) then return jsonb_build_object('ok', false, 'error', 'full', 'reason', private.reason(e)); end if;
  update private.bookings set session_id = p_session, status = 'Held', hold_expires_at = now() + interval '30 minutes',
    last_activity_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'holdExpiresAt', now() + interval '30 minutes', 'character', private.assign_organizer(p_id, e));
end $$;

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
  where x.booking_id = p_id and x.member_id = r ->> 'member' and r ->> 'strength' = 'required'
    and r ->> 'choice' not in ('anyF', 'anyM', 'none');
  update private.bookings set status = 'Booked', hold_expires_at = null, booked_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.assign_organizer(text, jsonb) from public, anon, authenticated;
