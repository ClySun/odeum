-- =====================================================================================
-- 010 · Age ranges no longer depend on the dash character                (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- Birth years were being turned into age ranges whose dash didn't match the rest of the system on
-- the live database, so those players' ages were ignored in matching. Age ranges are now compared
-- by their digits only, the dash is built from its character code, and ranges already saved from
-- a birth year are repaired.
-- =====================================================================================

create or replace function private.age_mid(r text) returns numeric
language sql immutable set search_path = '' as $$
  select case regexp_replace(coalesce(r, ''), '[^0-9+]', '', 'g')
              when '1821' then 19.5 when '2225' then 23.5 when '2635' then 30.5
              when '3640' then 38 when '41+' then 45 end
$$;

create or replace function private.age_range_from_year(y int) returns text
language sql stable set search_path = '' as $$
  -- the en dash is built with chr(8211) so it survives copy and paste into the SQL editor
  select case when y is null then null
              else (select case when a < 18 then null when a <= 21 then '18' || chr(8211) || '21'
                                when a <= 25 then '22' || chr(8211) || '25' when a <= 35 then '26' || chr(8211) || '35'
                                when a <= 40 then '36' || chr(8211) || '40' else '41+' end
                    from (select extract(year from current_date)::int - y as a) t) end
$$;

update private.people set age_range = private.age_range_from_year(birth_year), updated_at = now()
where birth_year is not null and age_range is distinct from private.age_range_from_year(birth_year);

revoke all on function private.age_mid(text), private.age_range_from_year(int) from public, anon, authenticated;
