-- =====================================================================================
-- 011 · Easy-to-read views for the team                                  (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- Then: Table Editor → schema "private" → open "signups" or "tables_overview".
-- Views live in the private schema, so the website can't reach them.
-- =====================================================================================

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
