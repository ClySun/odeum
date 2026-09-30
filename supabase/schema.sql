-- =====================================================================================
-- Odeum — Supabase database
-- Paste this whole file into Supabase → SQL Editor → Run.  Safe to run again after edits.
--
-- STRUCTURE (all tables in the `private` schema)
--   games ──< characters                    what can be played
--   games ──< sessions                      one table on one night (two tables a night = two sessions)
--   people                                  one row per human; `email` is set only once verified
--   people × games → quiz_results           latest quiz answers + character scores (overwritten on retake)
--   sessions ──< bookings ──< seats >── people
--   seats ── pairing_comfort                PRIVATE, per person per booking
--   bookings ──< recommendations            every table-matching calculation, kept as a snapshot
--   messages                                every email/nudge sent (so nobody gets one twice)
--
-- PRIVACY
--   The website's key cannot reach the `private` schema, and every table has row-level security
--   with no policies. The site can only call the functions at the bottom of this file; each
--   returns just what one screen needs. Pairing comfort is only ever returned to that person.
--   You (admin) see everything in Table Editor → schema "private".
-- =====================================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------- tables ----------

create table if not exists private.games (
  id          text primary key,                           -- short id, e.g. prague
  title       text not null,
  era         text,
  seats       int  not null default 6 check (seats between 1 and 20),
  time_label  text not null default '6:00–11:00 PM',
  area        text,                                       -- neighbourhood shown publicly
  status      text not null default 'Open' check (status in ('Coming soon', 'Open', 'Retired')),
  description text,
  image_url   text,
  created_at  timestamptz not null default now()
);

create table if not exists private.characters (
  game_id      text not null references private.games (id) on delete cascade,
  id           text not null,                             -- e.g. eva
  name         text not null,
  gender       text not null check (gender in ('male', 'female')),
  line         text,                                      -- one-line description
  portrait_url text,
  partner_id   text,                                      -- in-game romantic partner (a character id)
  relationship text,                                      -- e.g. Married
  sort         int  not null default 0,
  primary key (game_id, id)
);

create table if not exists private.sessions (
  id          uuid primary key default gen_random_uuid(),
  game_id     text not null references private.games (id),
  night       date not null,
  time_label  text,                                       -- blank = the game's usual time
  seats       int check (seats between 1 and 20),         -- blank = the game's seats
  status      text not null default 'Open' check (status in ('Open', 'Closed')),
  area        text,                                       -- blank = the game's area
  address     text,                                       -- private; sent to players before the game
  game_master text,
  note        text,                                       -- for you; never shown
  created_at  timestamptz not null default now()
);
create index if not exists sessions_by_night on private.sessions (game_id, night);

create table if not exists private.people (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users (id) on delete set null,
  email                text unique,                       -- verified with a login code
  contact_email        text,                              -- as typed; not verified yet
  name                 text,
  phone                text,
  age_range            text,                              -- worked out from birth_year when given
  birth_year           int check (birth_year between 1900 and 2100),
  gender               text,                              -- man | woman | nonbinary | self
  gender_text          text,
  newsletter_opt_in_at timestamptz,
  sms_opt_in_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists people_by_contact on private.people (lower(contact_email));
alter table private.people add column if not exists birth_year int check (birth_year between 1900 and 2100);

create table if not exists private.quiz_results (
  person_id  uuid not null references private.people (id) on delete cascade,
  game_id    text not null references private.games (id) on delete cascade,
  answers    jsonb not null default '{}',
  scores     jsonb not null default '{}',                 -- {"eva": 92, "vera": 71, …} percent fit
  top_match  text,
  updated_at timestamptz not null default now(),
  primary key (person_id, game_id)
);

create table if not exists private.bookings (
  id                text primary key,                     -- random id made by the browser
  draft_secret_hash text not null,                        -- proves the browser that started the draft
  owner             uuid references auth.users (id) on delete set null,
  organizer_id      uuid references private.people (id) on delete set null,
  email             text,                                 -- organizer's email as typed (checked at booking)
  party_token       text unique,                          -- secret in the one link friends use
  game_id           text not null references private.games (id),
  join_session_id   uuid references private.sessions (id) on delete set null,  -- "joining friends" night
  session_id        uuid references private.sessions (id),
  status            text not null default 'Draft' check (status in ('Draft', 'Held', 'Booked', 'Cancelled')),
  hold_expires_at   timestamptz,
  group_size        int  not null default 1 check (group_size between 1 and 20),
  real_life_couples jsonb not null default '[]',          -- [["Ana","Ben"]]
  character_prefs   jsonb not null default '[]',          -- [{"member":"ftwo","who":"Ben","choice":"vera","strength":"required"}]
  plus_one          boolean not null default false,       -- "Me and my plus-one": cast the pair as an in-game couple
  special_requests  text,
  email_verified_at timestamptz,
  booked_at         timestamptz,
  last_activity_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists bookings_by_session on private.bookings (session_id) where status in ('Held', 'Booked');
alter table private.bookings add column if not exists plus_one boolean not null default false;

create table if not exists private.seats (
  id                 text primary key,                    -- <booking id>-<member id>
  booking_id         text not null references private.bookings (id) on delete cascade,
  member_id          text not null,                       -- 'me' = the organizer
  person_id          uuid references private.people (id) on delete set null,
  role               text not null check (role in ('Organizer', 'Friend')),
  character_gender   text check (character_gender in ('male', 'female')),  -- chosen in the quiz; blank = plays their own gender
  scores             jsonb,                               -- copy of their character scores when this booking was made
  top_matches        text,
  special_requests   text,
  quiz_status        text not null default 'Not started'
                     check (quiz_status in ('Not started', 'In progress', 'Complete', 'Removed')),
  assigned_character text,                                -- you fill this in: eva, vaclav, milan, vera, tomas, petra
  admin_note         text,                                -- flags for the team, e.g. "Also booked in …"
  updated_at         timestamptz not null default now()
);
create index if not exists seats_by_booking on private.seats (booking_id);
create index if not exists seats_by_person on private.seats (person_id);
alter table private.seats add column if not exists admin_note text;

-- PRIVATE: in-game romantic pairing comfort, per person per booking.
create table if not exists private.pairing_comfort (
  seat_id    text primary key references private.seats (id) on delete cascade,
  comfort    text[] not null default '{}',                -- man | woman | nonbinary
  updated_at timestamptz not null default now()
);

create table if not exists private.recommendations (
  id             bigint generated always as identity primary key,
  booking_id     text not null references private.bookings (id) on delete cascade,
  session_id     uuid not null references private.sessions (id) on delete cascade,
  calculated_at  timestamptz not null,
  passed         boolean not null,                        -- met every minimum requirement
  reason         text,                                    -- why not, e.g. "Age gap 11 years"
  rank           int,                                     -- 1–3 when recommended
  started        boolean,
  seats_left     int,
  age_gap        numeric,
  comfort_ok     boolean,
  char_fit       numeric,                                 -- organizer's best open character, %
  best_character text,
  score          numeric
);
create index if not exists recs_by_booking on private.recommendations (booking_id, calculated_at desc);

create table if not exists private.messages (
  id         bigint generated always as identity primary key,
  booking_id text references private.bookings (id) on delete set null,
  person_id  uuid references private.people (id) on delete set null,
  kind       text not null,                               -- confirmation | filling_up | table_filled | finish_reminder | …
  to_email   text,
  detail     jsonb,
  sent_at    timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['games', 'characters', 'sessions', 'people', 'quiz_results', 'bookings', 'seats',
                           'pairing_comfort', 'recommendations', 'messages'] loop
    execute format('alter table private.%I enable row level security', t);
  end loop;
end $$;
revoke all on all tables in schema private from public, anon, authenticated;

-- ---------- starting data (edit freely in Table Editor afterwards) ----------

insert into private.games (id, title, era, seats, area, status, description, image_url) values
  ('prague', 'Summertime in Prague', 'Czechoslovakia, 1968', 6, 'Upper West Side', 'Open',
   'You are writers for Dialog, a literary magazine pushing the limits of what can be published.', '/images/mirror.webp')
on conflict (id) do nothing;

insert into private.characters (game_id, id, name, gender, line, portrait_url, partner_id, relationship, sort) values
  ('prague', 'eva',    'Eva',    'female', 'Art & culture critic. Speaks three languages.',            '/images/prague/cast/eva.jpg',    'vaclav', 'Married', 1),
  ('prague', 'vaclav', 'Vaclav', 'male',   'Poet. Full of charm; the world is dreamier in his eyes.',  '/images/prague/cast/vaclav.jpg', 'eva',    'Married', 2),
  ('prague', 'milan',  'Milan',  'male',   'Absurdist storyteller who wanders the city’s cemeteries.', '/images/prague/cast/milan.jpg',  'vera',   'Dating', 3),
  ('prague', 'vera',   'Vera',   'female', 'Rock-scene writer and drummer. Hard to approach at first.', '/images/prague/cast/vera.jpg',  'milan',  'Dating', 4),
  ('prague', 'tomas',  'Tomas',  'male',   'Literature teacher who sneaks banned books to students.',  '/images/prague/cast/tomas.jpg',  'petra',  'Married with kids', 5),
  ('prague', 'petra',  'Petra',  'female', 'Theatre director. “Small but mighty.”',                    '/images/prague/cast/petra.jpg',  'tomas',  'Married with kids', 6)
on conflict do nothing;

insert into private.sessions (game_id, night)
select 'prague', d::date from unnest(array['2026-10-23', '2026-10-24', '2026-10-30', '2026-10-31', '2026-11-06', '2026-11-07',
                                           '2026-11-13', '2026-11-14', '2026-11-20', '2026-11-21', '2026-11-27', '2026-11-28']) d
where not exists (select 1 from private.sessions where game_id = 'prague');

-- ---------- private helpers (not callable from the website) ----------

create or replace function private.hash(t text) returns text
language sql immutable set search_path = '' as $$ select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex') $$;

create or replace function private.clip(t text, n int default 200) returns text
language sql immutable set search_path = '' as $$ select left(nullif(btrim(t), ''), n) $$;

-- Midpoint of an age range. Compares digits only, so it works whatever dash character the range
-- was stored with ("26–35", "26-35", …).
create or replace function private.age_mid(r text) returns numeric
language sql immutable set search_path = '' as $$
  select case regexp_replace(coalesce(r, ''), '[^0-9+]', '', 'g')
              when '1821' then 19.5 when '2225' then 23.5 when '2635' then 30.5
              when '3640' then 38 when '41+' then 45 end
$$;

-- Birth year as typed ({"birthYear": "1995"}), or null.
create or replace function private.birth_year(j jsonb) returns int
language sql immutable set search_path = '' as $$
  select case when j ->> 'birthYear' ~ '^\d{4}$' and (j ->> 'birthYear')::int between 1900 and 2100 then (j ->> 'birthYear')::int end
$$;

-- The age range used for matching, from a birth year.
create or replace function private.age_range_from_year(y int) returns text
language sql stable set search_path = '' as $$
  -- the en dash is built with chr(8211) so it survives copy and paste into the SQL editor
  select case when y is null then null
              else (select case when a < 18 then null when a <= 21 then '18' || chr(8211) || '21'
                                when a <= 25 then '22' || chr(8211) || '25' when a <= 35 then '26' || chr(8211) || '35'
                                when a <= 40 then '36' || chr(8211) || '40' else '41+' end
                    from (select extract(year from current_date)::int - y as a) t) end
$$;

-- Which characters a player can take: the gender they chose in the quiz, else their own gender.
create or replace function private.char_need(p_gender text, p_chosen text) returns text
language sql immutable set search_path = '' as $$
  select case when p_chosen in ('male', 'female') then p_chosen
              when p_gender = 'man' then 'male' when p_gender = 'woman' then 'female' else 'any' end
$$;

create or replace function private.comfort_array(j jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct v), '{}')
  from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]' end) v
  where v in ('man', 'woman', 'nonbinary')
$$;

create or replace function private.signed_in_email() returns text
language sql stable set search_path = '' as $$ select lower(nullif(auth.jwt() ->> 'email', '')) $$;

create or replace function private.night_label(p_session uuid) returns text
language sql stable set search_path = '' as $$
  select to_char(s.night, 'FMDay, FMMonth FMDD, YYYY') || ' · ' || coalesce(nullif(s.time_label, ''), g.time_label)
  from private.sessions s join private.games g on g.id = s.game_id where s.id = p_session
$$;

-- Seats taken at a session by OTHER bookings (booked, or held and not yet expired).
create or replace function private.table_seats(p_session uuid, p_except text)
returns table (seat_id text, gender text, need text, assigned text, age numeric)
language sql stable set search_path = '' as $$
  select s.id, p.gender, private.char_need(p.gender, s.character_gender), lower(nullif(s.assigned_character, '')),
         private.age_mid(p.age_range)
  from private.seats s
  join private.bookings b on b.id = s.booking_id
  left join private.people p on p.id = s.person_id
  where b.session_id = p_session and b.id is distinct from p_except and s.quiz_status <> 'Removed'
    and (b.status = 'Booked' or (b.status = 'Held' and b.hold_expires_at > now()))
$$;

-- How many more players of each gender a table can take: free characters of that gender minus the
-- seats already waiting for one (e.g. a friend who hasn't done their quiz yet).
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

-- When a table is full, anyone still without a character (a friend who hasn't done their quiz)
-- is given one of the characters left, matching the gender they need.
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

-- Checks one table for one booking. Returns the minimum requirements separately, so the same
-- check serves recommendations (all must pass) and "all available dates" (age only warns).
create or replace function private.evaluate(p_booking text, p_session uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  b private.bookings; s private.sessions; g private.games;
  v_cap int; v_taken int; v_left int; v_size int; v_tbl_age numeric; v_grp_age numeric; v_gap numeric;
  v_free text[]; v_free_m int; v_free_f int; v_need_m int := 0; v_need_f int := 0; v_need_any int := 0;
  v_required_ok boolean := true; v_comfort text[]; v_org_need text; v_org_req text; v_cands text[];
  v_comfort_ok boolean := true; v_fit numeric; v_best text; v_scores jsonb; r jsonb; m record; c record;
  v_req_members text[] := '{}'; v_req_chars text[] := '{}';
  v_joining boolean; v_couple_ok boolean := true; v_po_need text; v_partner text;
begin
  select * into b from private.bookings where id = p_booking;
  select * into s from private.sessions where id = p_session;
  select * into g from private.games where id = s.game_id;
  v_cap := coalesce(s.seats, g.seats);

  select count(*), avg(age) into v_taken, v_tbl_age from private.table_seats(s.id, b.id);
  v_left := v_cap - v_taken;
  select count(*), avg(private.age_mid(p.age_range)) into v_size, v_grp_age
  from private.seats x left join private.people p on p.id = x.person_id
  where x.booking_id = b.id and x.quiz_status <> 'Removed';
  v_size := greatest(v_size, 1);
  v_gap := case when v_taken > 0 and v_tbl_age is not null and v_grp_age is not null then round(abs(v_tbl_age - v_grp_age), 1) end;

  -- characters still free at this table
  select array_agg(ch.id order by ch.sort) into v_free from private.characters ch
  where ch.game_id = g.id and ch.id not in (select t.assigned from private.table_seats(s.id, b.id) t where t.assigned is not null);
  v_free := coalesce(v_free, '{}');

  -- Required character requests only (a preference never rules a table out)
  for r in select * from jsonb_array_elements(b.character_prefs) loop
    if r ->> 'strength' = 'required' and r ->> 'choice' not in ('anyF', 'anyM', 'none') then
      if not (r ->> 'choice' = any (v_free)) then v_required_ok := false; end if;
      v_req_members := v_req_members || (r ->> 'member');
      v_req_chars := v_req_chars || (r ->> 'choice');
    end if;
  end loop;

  -- can everyone get a character of the right gender?
  select count(*) filter (where ch.gender = 'male'), count(*) filter (where ch.gender = 'female') into v_free_m, v_free_f
  from private.characters ch where ch.game_id = g.id and ch.id = any (v_free) and not (ch.id = any (v_req_chars));
  for m in
    select t.need from private.table_seats(s.id, b.id) t where t.assigned is null
    union all
    select case when pr.rp ->> 'choice' = 'anyF' and pr.rp ->> 'strength' = 'required' then 'female'
                when pr.rp ->> 'choice' = 'anyM' and pr.rp ->> 'strength' = 'required' then 'male'
                else private.char_need(p.gender, x.character_gender) end
    from private.seats x left join private.people p on p.id = x.person_id
    left join lateral (select e as rp from jsonb_array_elements(b.character_prefs) e where e ->> 'member' = x.member_id limit 1) pr on true
    where x.booking_id = b.id and x.quiz_status <> 'Removed' and not (x.member_id = any (v_req_members))
  loop
    if m.need = 'male' then v_need_m := v_need_m + 1; elsif m.need = 'female' then v_need_f := v_need_f + 1; else v_need_any := v_need_any + 1; end if;
  end loop;

  -- organizer: which characters could they play here, and how well do they fit?
  select private.char_need(p.gender, x.character_gender), pc.comfort into v_org_need, v_comfort
  from private.seats x left join private.people p on p.id = x.person_id
  left join private.pairing_comfort pc on pc.seat_id = x.id
  where x.booking_id = b.id and x.member_id = 'me';
  select e ->> 'choice' into v_org_req from jsonb_array_elements(b.character_prefs) e
  where e ->> 'member' = 'me' and e ->> 'strength' = 'required' and e ->> 'choice' not in ('anyF', 'anyM', 'none') limit 1;
  select array_agg(ch.id) into v_cands from private.characters ch
  where ch.game_id = g.id and ch.id = any (v_free)
    and ((v_org_req is null and not (ch.id = any (v_req_chars)) and (coalesce(v_org_need, 'any') = 'any' or ch.gender = v_org_need))
         or ch.id = v_org_req);
  v_cands := coalesce(v_cands, '{}');

  -- joining friends: only the seat count matters; a taken character just means another seat
  v_joining := b.join_session_id is not null and b.join_session_id = s.id;

  -- plus-one: the organizer's character must have its in-game partner free for the plus-one
  if b.plus_one and not v_joining then
    select private.char_need(p.gender, x.character_gender) into v_po_need
    from private.seats x left join private.people p on p.id = x.person_id
    where x.booking_id = b.id and x.role = 'Friend' and x.quiz_status <> 'Removed' limit 1;
    select array_agg(ch.id) into v_cands from private.characters ch
    join private.characters pt on pt.game_id = ch.game_id and pt.id = ch.partner_id
    where ch.game_id = g.id and ch.id = any (v_cands) and pt.id = any (v_free) and not (pt.id = any (v_req_chars))
      and (coalesce(v_po_need, 'any') = 'any' or pt.gender = v_po_need);
    v_cands := coalesce(v_cands, '{}');
    v_couple_ok := coalesce(array_length(v_cands, 1), 0) > 0;
  end if;

  -- pairing comfort (the organizer's, the one known at this point): some character they could play
  -- has no partner, or a partner played by someone they're comfortable with. A partner not yet cast
  -- is expected to be played by someone of that character's gender (or a nonbinary player).
  if coalesce(array_length(v_comfort, 1), 0) > 0 then
    v_comfort_ok := false;
    for c in select ch.id, ch.partner_id, pt.gender as partner_gender,
                    (select t.gender from private.table_seats(s.id, b.id) t where t.assigned = ch.partner_id limit 1) as partner_player
             from private.characters ch left join private.characters pt on pt.game_id = ch.game_id and pt.id = ch.partner_id
             where ch.game_id = g.id and ch.id = any (v_cands) loop
      if c.partner_id is null
         or (c.partner_player is not null and (case when c.partner_player in ('man', 'woman') then c.partner_player else 'nonbinary' end) = any (v_comfort))
         or (c.partner_player is null and ((case c.partner_gender when 'male' then 'man' else 'woman' end) = any (v_comfort) or 'nonbinary' = any (v_comfort))) then
        v_comfort_ok := true;
      end if;
    end loop;
  end if;

  select q.scores into v_scores from private.quiz_results q
  join private.seats x on x.person_id = q.person_id and x.booking_id = b.id and x.member_id = 'me'
  where q.game_id = g.id;
  if v_scores is not null then
    select (v_scores ->> ch.id)::numeric, ch.id into v_fit, v_best from private.characters ch
    where ch.game_id = g.id and ch.id = any (v_cands) and v_scores ? ch.id
    order by (v_scores ->> ch.id)::numeric desc limit 1;
  end if;

  if b.plus_one and not v_joining and v_best is null then
    select ch.id into v_best from private.characters ch where ch.game_id = g.id and ch.id = any (v_cands) order by ch.sort limit 1;
  end if;
  if b.plus_one and not v_joining and v_best is not null then
    select partner_id into v_partner from private.characters where game_id = g.id and id = v_best;
  end if;

  return jsonb_build_object(
    'seatsOk', v_left >= v_size,
    'charactersOk', v_joining or (v_need_m <= v_free_m and v_need_f <= v_free_f and v_need_m + v_need_f + v_need_any <= v_free_m + v_free_f),
    'requiredOk', v_joining or v_required_ok,
    'comfortOk', v_joining or v_comfort_ok,
    'couplesOk', v_joining or v_couple_ok,
    'ageOk', v_joining or v_gap is null or v_gap <= 10,
    'started', v_taken > 0, 'seatsLeft', greatest(v_left, 0), 'ageGap', v_gap, 'tableAge', round(v_tbl_age),
    'charFit', v_fit, 'bestCharacter', v_best, 'partnerCharacter', v_partner, 'openCharacters', to_jsonb(v_free));
end $$;

create or replace function private.bookable(e jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select (e ->> 'seatsOk')::boolean and (e ->> 'charactersOk')::boolean and (e ->> 'requiredOk')::boolean and (e ->> 'comfortOk')::boolean
         and coalesce((e ->> 'couplesOk')::boolean, true)
$$;

create or replace function private.reason(e jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when not (e ->> 'seatsOk')::boolean then 'Not enough seats'
              when not (e ->> 'charactersOk')::boolean then 'No open character for everyone'
              when not (e ->> 'requiredOk')::boolean then 'Required character taken'
              when not (e ->> 'comfortOk')::boolean then 'Pairing comfort can''t be honoured'
              when not coalesce((e ->> 'couplesOk')::boolean, true) then 'No in-game couple free for you and your plus-one'
              when not (e ->> 'ageOk')::boolean then 'Age gap ' || (e ->> 'ageGap') || ' years' end
$$;

create or replace function private.can_edit(v private.bookings, p_secret text) returns boolean
language sql stable set search_path = '' as $$
  select v.draft_secret_hash = private.hash(p_secret) or (auth.uid() is not null and v.owner = auth.uid())
$$;

-- Moves everything from one person record into another, then deletes the first.
create or replace function private.merge_person(p_from uuid, p_into uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if p_from is null or p_into is null or p_from = p_into then return; end if;
  update private.seats set person_id = p_into where person_id = p_from;
  update private.bookings set organizer_id = p_into where organizer_id = p_from;
  update private.messages set person_id = p_into where person_id = p_from;
  insert into private.quiz_results (person_id, game_id, answers, scores, top_match, updated_at)
  select p_into, q.game_id, q.answers, q.scores, q.top_match, q.updated_at from private.quiz_results q where q.person_id = p_from
  on conflict (person_id, game_id) do update set answers = excluded.answers, scores = excluded.scores,
    top_match = excluded.top_match, updated_at = excluded.updated_at
  where excluded.updated_at > private.quiz_results.updated_at;
  update private.people t set name = coalesce(t.name, f.name), phone = coalesce(t.phone, f.phone),
    age_range = coalesce(t.age_range, f.age_range), gender = coalesce(t.gender, f.gender),
    gender_text = coalesce(t.gender_text, f.gender_text),
    newsletter_opt_in_at = coalesce(t.newsletter_opt_in_at, f.newsletter_opt_in_at),
    sms_opt_in_at = coalesce(t.sms_opt_in_at, f.sms_opt_in_at), updated_at = now()
  from private.people f where t.id = p_into and f.id = p_from;
  delete from private.people where id = p_from;
end $$;

-- The signed-in person's record: found by login, else by verified email, else created. Any
-- unverified records typed with this email (e.g. a friend's quiz) are merged in.
create or replace function private.ensure_person() returns uuid
language plpgsql set search_path = '' as $$
declare v_email text := private.signed_in_email(); v_id uuid; r record;
begin
  if auth.uid() is null or v_email is null then raise exception 'not_signed_in'; end if;
  select id into v_id from private.people where user_id = auth.uid();
  if v_id is null then select id into v_id from private.people where email = v_email; end if;
  if v_id is null then
    insert into private.people (user_id, email, contact_email) values (auth.uid(), v_email, v_email) returning id into v_id;
  else
    update private.people set user_id = auth.uid(), email = v_email where id = v_id;
  end if;
  for r in select id from private.people where id <> v_id and email is null and lower(contact_email) = v_email loop
    perform private.merge_person(r.id, v_id);
  end loop;
  return v_id;
end $$;

-- Admin: seat someone by hand. Run in SQL Editor, e.g.
--   select private.admin_add_player((select id from private.sessions where night = '2026-10-24' limit 1),
--                                   'Jane Doe', 'jane@example.com', '26–35', 'woman', 'eva');
create or replace function private.admin_add_player(p_session uuid, p_name text, p_email text, p_age_range text,
                                                    p_gender text, p_character text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := 'admin' || substr(md5(random()::text || clock_timestamp()::text), 1, 12); v_person uuid;
begin
  select id into v_person from private.people where email = lower(p_email) or lower(contact_email) = lower(p_email) limit 1;
  if v_person is null then
    insert into private.people (contact_email, name, age_range, gender) values (lower(p_email), p_name, p_age_range, p_gender)
    returning id into v_person;
  end if;
  insert into private.bookings (id, draft_secret_hash, organizer_id, email, game_id, session_id, status, group_size, booked_at)
  select v_id, private.hash(v_id || random()::text), v_person, lower(p_email), s.game_id, s.id, 'Booked', 1, now()
  from private.sessions s where s.id = p_session;
  insert into private.seats (id, booking_id, member_id, person_id, role, quiz_status, assigned_character)
  values (v_id || '-me', v_id, 'me', v_person, 'Organizer', 'Not started', nullif(lower(p_character), ''));
  return v_id;
end $$;

-- Admin: someone asked to be forgotten. Run in SQL Editor:  select private.admin_forget('jane@example.com');
-- Deletes their login, drafts, quiz results and pairing answers, and blanks their details. Seats
-- they held stay counted until you cancel that booking.
create or replace function private.admin_forget(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := lower(btrim(p_email));
begin
  delete from private.bookings where status = 'Draft' and lower(email) = v;
  delete from private.pairing_comfort where seat_id in
    (select x.id from private.seats x join private.people p on p.id = x.person_id where p.email = v or lower(p.contact_email) = v);
  delete from private.quiz_results where person_id in (select id from private.people where email = v or lower(contact_email) = v);
  update private.people set name = '(deleted)', email = null, contact_email = null, phone = null, gender_text = null,
         newsletter_opt_in_at = null, sms_opt_in_at = null, user_id = null, updated_at = now()
  where email = v or lower(contact_email) = v;
  update private.bookings set email = null, special_requests = null, updated_at = now() where lower(email) = v;
  delete from auth.users where lower(email) = v;
  return 'Forgot ' || v;
end $$;

-- ---------- views for the team (Table Editor → private) ----------

-- One row per person per booking, newest bookings first.
create or replace view private.signups as
select
  s.night                                                       as night,
  coalesce(nullif(s.time_label, ''), g.time_label)              as time,
  b.status                                                      as booking_status,
  x.role                                                        as role,
  p.name                                                        as name,
  coalesce(p.email, p.contact_email)                            as email,
  p.email is not null                                           as email_verified,
  p.phone                                                       as phone,
  p.birth_year                                                  as birth_year,
  p.age_range                                                   as age_range,
  case when p.gender = 'self' then coalesce(p.gender_text, 'self-described') else p.gender end as gender,
  x.character_gender                                            as plays_a,
  x.quiz_status                                                 as quiz,
  x.assigned_character                                          as character,
  x.top_matches                                                 as top_matches,
  x.special_requests                                            as special_requests,
  array_to_string(pc.comfort, ', ')                             as pairing_comfort_private,
  x.admin_note                                                  as flag,
  op.name                                                       as organizer,
  b.group_size                                                  as group_size,
  b.plus_one                                                    as plus_one,
  b.real_life_couples                                           as real_life_couples,
  b.character_prefs                                             as character_picks,
  p.newsletter_opt_in_at is not null                            as newsletter_ok,
  p.sms_opt_in_at is not null                                   as texts_ok,
  b.booked_at                                                   as booked_at,
  b.created_at                                                  as started_at,
  b.id                                                          as booking_id,
  s.id                                                          as session_id
from private.bookings b
join private.seats x on x.booking_id = b.id and x.quiz_status <> 'Removed'
left join private.people p on p.id = x.person_id
left join private.people op on op.id = b.organizer_id
left join private.sessions s on s.id = b.session_id
left join private.games g on g.id = b.game_id
left join private.pairing_comfort pc on pc.seat_id = x.id
order by b.created_at desc, x.role desc, p.name;

-- One row per table (session): who's in it at a glance.
create or replace view private.tables_overview as
select
  s.night                                                       as night,
  coalesce(nullif(s.time_label, ''), g.time_label)              as time,
  g.title                                                       as game,
  s.status                                                      as status,
  coalesce(s.seats, g.seats)                                    as seats,
  (select count(*) from private.table_seats(s.id, null))        as taken,
  coalesce(s.seats, g.seats) - (select count(*) from private.table_seats(s.id, null)) as seats_left,
  (select string_agg(t.assigned, ', ' order by t.assigned) from private.table_seats(s.id, null) t where t.assigned is not null) as characters_taken,
  (select count(*) from private.table_seats(s.id, null) t where t.assigned is null) as undecided,
  (select round(avg(t.age)) from private.table_seats(s.id, null) t)                  as average_age,
  (select count(distinct b.id) from private.bookings b where b.session_id = s.id and b.status = 'Booked') as bookings,
  s.game_master                                                 as game_master,
  s.note                                                        as note,
  s.id                                                          as session_id
from private.sessions s join private.games g on g.id = s.game_id
order by s.night, s.created_at;

revoke all on private.signups, private.tables_overview from public, anon, authenticated;

-- ---------- website API ----------

-- The game and its cast (public information).
create or replace function public.game_info(p_game text default 'prague') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'v', 3, 'id', g.id, 'title', g.title, 'era', g.era, 'seats', g.seats,
      'time', g.time_label, 'area', g.area,
      'characters', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'gender', c.gender, 'line', c.line,
                       'art', c.portrait_url, 'partner', c.partner_id, 'relationship', c.relationship) order by c.sort)
                     from private.characters c where c.game_id = g.id))
    from private.games g where g.id = p_game and g.status <> 'Retired'),
    jsonb_build_object('ok', false, 'error', 'not_found'))
$$;

-- Upcoming open tables with seat counts. No names, contacts or ages.
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

-- Saves the organizer's form as they go (before email verification). Only the browser holding the
-- draft's secret — or its verified owner — can change it. A booked booking is never changed here.
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

-- Recommended tables: minimum requirements first (seats, a character for everyone, pairing comfort,
-- age within 10 years; a Required character only if one was asked for). Started tables only — new
-- tables, soonest first, fill in only when fewer than 3 started tables pass. Every table checked is
-- saved to recommendations with the reason it was or wasn't suggested.
create or replace function public.recommend(p_id text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; v_now timestamptz := clock_timestamp(); v_prev timestamptz; s record; e jsonb; v_started int;
begin
  select * into v from private.bookings where id = p_id;
  if not found or not private.can_edit(v, p_secret) then raise exception 'forbidden'; end if;
  select max(calculated_at) into v_prev from private.recommendations where booking_id = p_id;

  for s in select x.id, x.night from private.sessions x
           where x.game_id = v.game_id and x.status = 'Open' and x.night > current_date
             and (v.join_session_id is null or x.id = v.join_session_id) loop
    e := private.evaluate(p_id, s.id);
    insert into private.recommendations (booking_id, session_id, calculated_at, passed, reason, started, seats_left, age_gap,
                                         comfort_ok, char_fit, best_character, score)
    values (p_id, s.id, v_now, private.bookable(e) and (e ->> 'ageOk')::boolean, private.reason(e), (e ->> 'started')::boolean,
            (e ->> 'seatsLeft')::int, (e ->> 'ageGap')::numeric, (e ->> 'comfortOk')::boolean, (e ->> 'charFit')::numeric,
            e ->> 'bestCharacter', coalesce((e ->> 'charFit')::numeric, 50) - 3 * coalesce((e ->> 'ageGap')::numeric, 0));
  end loop;

  select count(*) into v_started from private.recommendations r where r.booking_id = p_id and r.calculated_at = v_now and r.passed and r.started;
  with ranked as (
    select r.id, row_number() over (order by r.started desc,
             case when r.started then r.score end desc nulls last, x.night, x.created_at) as rk
    from private.recommendations r join private.sessions x on x.id = r.session_id
    where r.booking_id = p_id and r.calculated_at = v_now and r.passed and (r.started or v_started < 3)
  )
  update private.recommendations r set rank = ranked.rk from ranked where r.id = ranked.id and ranked.rk <= 3;

  update private.bookings set last_activity_at = now() where id = p_id;

  return jsonb_build_object('ok', true,
    'tables', coalesce((select jsonb_agg(jsonb_build_object('sessionId', r.session_id, 'date', to_char(x.night, 'YYYY-MM-DD'),
                  'time', coalesce(nullif(x.time_label, ''), g.time_label), 'area', coalesce(nullif(x.area, ''), g.area),
                  'started', r.started, 'seatsLeft', r.seats_left, 'ageGap', r.age_gap, 'charFit', r.char_fit,
                  'bestCharacter', r.best_character,
                  'partnerCharacter', private.evaluate(p_id, r.session_id) ->> 'partnerCharacter',
                  'openCharacters', private.evaluate(p_id, r.session_id) -> 'openCharacters') order by r.rank)
                from private.recommendations r join private.sessions x on x.id = r.session_id join private.games g on g.id = x.game_id
                where r.booking_id = p_id and r.calculated_at = v_now and r.rank is not null), '[]'),
    -- tables suggested last time that no longer pass
    'noLongerAvailable', coalesce((select jsonb_agg(to_char(x.night, 'YYYY-MM-DD') order by x.night)
                from private.recommendations p join private.sessions x on x.id = p.session_id
                where p.booking_id = p_id and p.calculated_at = v_prev and p.rank is not null
                  and not exists (select 1 from private.recommendations n where n.booking_id = p_id and n.calculated_at = v_now
                                  and n.session_id = p.session_id and n.passed)), '[]'));
end $$;

-- "See all available dates": every open table, with what this booking needs to know about it.
-- Age only warns here; a table is bookable if seats, characters, requests and comfort work.
create or replace function public.browse_tables(p_id text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings;
begin
  select * into v from private.bookings where id = p_id;
  if not found or not private.can_edit(v, p_secret) then raise exception 'forbidden'; end if;
  return jsonb_build_object('ok', true, 'sessions', coalesce((
    select jsonb_agg(jsonb_build_object('sessionId', t.id, 'date', to_char(t.night, 'YYYY-MM-DD'), 'time', t.time,
             'started', (t.e ->> 'started')::boolean, 'seatsLeft', (t.e ->> 'seatsLeft')::int, 'bookable', private.bookable(t.e),
             'reason', private.reason(t.e), 'ageGap', t.e -> 'ageGap', 'tableAge', t.e -> 'tableAge',
             'openCharacters', t.e -> 'openCharacters') order by t.night, t.created_at)
    from (select x.id, x.night, x.created_at, coalesce(nullif(x.time_label, ''), g.time_label) as time, private.evaluate(p_id, x.id) as e
          from private.sessions x join private.games g on g.id = x.game_id
          where x.game_id = v.game_id and x.status = 'Open' and x.night > current_date) t), '[]'));
end $$;

-- Gives the organizer their character at this table: the one they required, else their best fit
-- among the characters still open there. Other players' characters are assigned by the team.
create or replace function private.assign_organizer(p_id text, e jsonb) returns text
language plpgsql set search_path = '' as $$
declare v_req text; v_char text; v_partner text; v_plus boolean; v_game text;
begin
  select b.plus_one, b.game_id into v_plus, v_game from private.bookings b where b.id = p_id;
  select r ->> 'choice' into v_req from private.bookings b, jsonb_array_elements(b.character_prefs) r
  where b.id = p_id and r ->> 'member' = 'me' and r ->> 'choice' not in ('anyF', 'anyM', 'none')
    and (e -> 'openCharacters') ? (r ->> 'choice') limit 1;
  v_char := coalesce(v_req, e ->> 'bestCharacter');
  update private.seats set assigned_character = v_char, updated_at = now() where id = p_id || '-me';
  if v_plus then
    select c.partner_id into v_partner from private.characters c
    where c.game_id = v_game and c.id = v_char and (e -> 'openCharacters') ? c.partner_id;
    update private.seats set assigned_character = v_partner, updated_at = now()
    where booking_id = p_id and role = 'Friend' and quiz_status <> 'Removed';
  end if;
  return v_char;
end $$;

-- Holds the seats for 30 minutes while the organizer confirms, and reserves the organizer's character.
create or replace function public.hold_table(p_id text, p_secret text, p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; e jsonb; v_char text; v_partner text;
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
  v_char := private.assign_organizer(p_id, e);   -- save first, then read back the plus-one's character
  select x.assigned_character into v_partner from private.seats x join private.bookings k on k.id = x.booking_id
  where x.booking_id = p_id and x.role = 'Friend' and x.quiz_status <> 'Removed' and k.plus_one limit 1;
  return jsonb_build_object('ok', true, 'holdExpiresAt', now() + interval '30 minutes', 'character', v_char, 'partnerCharacter', v_partner);
end $$;

-- After the organizer verifies their email (Supabase Auth code), attach the booking to their account.
create or replace function public.claim_booking(p_id text, p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v private.bookings; v_email text := private.signed_in_email(); v_me uuid;
begin
  if auth.uid() is null or v_email is null then raise exception 'not_signed_in'; end if;
  select * into v from private.bookings where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not private.can_edit(v, p_secret) then raise exception 'forbidden'; end if;
  if v.email is distinct from v_email then return jsonb_build_object('ok', false, 'error', 'email_mismatch'); end if;
  v_me := private.ensure_person();
  perform private.merge_person(v.organizer_id, v_me);
  update private.bookings set owner = auth.uid(), organizer_id = v_me, email_verified_at = now(), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Confirms the booking (free during testing). Needs a verified email and a hold; an expired hold is
-- renewed if the table still has room. Runs under a per-table lock so the last seat can't go twice.
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

-- Friend link: who's in the party (so each friend can pick themselves). Needs the secret link.
create or replace function public.party_info(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('ok', true,
      'organizer', split_part(coalesce(op.name, ''), ' ', 1), 'game', b.game_id,
      'sessionLabel', private.night_label(b.session_id),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', x.member_id, 'name', p.name, 'age', p.age_range,
                                                              'gender', p.gender, 'done', x.quiz_status = 'Complete',
                                                              -- in a real-life couple within this party (yes/no only)
                                                              'partnered', exists (select 1 from jsonb_array_elements(b.real_life_couples) c where c ? p.name)) order by p.name)
                          from private.seats x left join private.people p on p.id = x.person_id
                          where x.booking_id = b.id and x.role = 'Friend' and x.quiz_status <> 'Removed'), '[]'))
    from private.bookings b left join private.people op on op.id = b.organizer_id
    where length(coalesce(p_token, '')) >= 12 and b.party_token = p_token and b.status = 'Booked'),
    jsonb_build_object('ok', false, 'error', 'not_found'))
$$;

-- What a friend can still play at their table (needs the secret link). Characters only — nothing
-- about the other players. `assigned` = their character is already fixed (plus-one, or picked
-- for them); `canPlay` = which genders still have a character free for them.
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

-- A friend submits their own details + quiz through the party link, after verifying their email
-- with a sign-in code (they must be signed in as the email they submit). Their record becomes
-- their own verified person record. Once complete it can't be overwritten through the link.
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

-- The signed-in person's portal: their details and their own bookings. For the rest of each party
-- it shows first names and whether each has finished the quiz — never anyone else's answers.
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

-- Organizer adds someone to a booked table from their portal (if a seat is free).
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

-- Organizer removes someone from their booking (their seat is freed; refunds follow the usual policy).
create or replace function public.portal_remove_person(p_id text, p_member text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.ensure_person();
begin
  update private.seats x set quiz_status = 'Removed', assigned_character = null, updated_at = now()
  from private.bookings b
  where b.id = x.booking_id and b.id = p_id and b.organizer_id = v_me and b.status = 'Booked'
    and x.member_id = p_member and x.role = 'Friend' and x.quiz_status <> 'Removed';
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update private.bookings set group_size = greatest(group_size - 1, 1), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cancel_booking(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := private.ensure_person();
begin
  update private.bookings set status = 'Cancelled', hold_expires_at = null, updated_at = now()
  where id = p_id and organizer_id = v_me and status in ('Held', 'Booked');
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- who may call what ----------
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.game_info(text), public.availability(text), public.save_draft(text, text, jsonb),
  public.recommend(text, text), public.browse_tables(text, text), public.hold_table(text, text, uuid),
  public.friend_options(text, text), public.claim_booking(text, text), public.book(text), public.party_info(text), public.friend_submit(text, text, jsonb),
  public.my_portal(), public.update_profile(jsonb), public.cancel_booking(text),
  public.portal_add_person(text, jsonb), public.portal_remove_person(text, text) from public, anon, authenticated;

grant execute on function public.game_info(text), public.availability(text), public.save_draft(text, text, jsonb),
  public.recommend(text, text), public.browse_tables(text, text), public.hold_table(text, text, uuid),
  public.party_info(text), public.friend_options(text, text) to anon, authenticated;
grant execute on function public.claim_booking(text, text), public.book(text), public.friend_submit(text, text, jsonb),
  public.my_portal(), public.update_profile(jsonb), public.cancel_booking(text),
  public.portal_add_person(text, jsonb), public.portal_remove_person(text, text) to authenticated;
