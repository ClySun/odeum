-- =====================================================================================
-- 005 · Party link says whether each friend is in a real-life couple      (30 Sep 2026)
-- Paste into Supabase → SQL Editor → Run.  Safe to run more than once.
-- A friend in a real-life couple (including a plus-one) isn't asked the pairing-comfort question.
-- Only a yes/no is shared, never who they're with.
-- =====================================================================================

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
