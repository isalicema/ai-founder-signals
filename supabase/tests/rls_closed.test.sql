begin;

select plan(15);

select ok((select relrowsecurity from pg_class where oid = 'public.source'::regclass), 'source has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.item'::regclass), 'item has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.entity'::regclass), 'entity has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.feedback'::regclass), 'feedback has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.job'::regclass), 'job has RLS enabled');

select ok(not has_table_privilege('anon', 'public.source', 'select'), 'anon cannot select source');
select ok(not has_table_privilege('anon', 'public.item', 'select'), 'anon cannot select item');
select ok(not has_table_privilege('anon', 'public.entity', 'select'), 'anon cannot select entity');
select ok(not has_table_privilege('anon', 'public.feedback', 'select'), 'anon cannot select feedback');
select ok(not has_table_privilege('anon', 'public.job', 'select'), 'anon cannot select job');

select ok(not has_table_privilege('authenticated', 'public.source', 'select'), 'authenticated cannot select source before M7');
select ok(not has_table_privilege('authenticated', 'public.item', 'select'), 'authenticated cannot select item before M7');
select ok(not has_table_privilege('authenticated', 'public.entity', 'select'), 'authenticated cannot select entity before M7');
select ok(not has_table_privilege('authenticated', 'public.feedback', 'select'), 'authenticated cannot select feedback before M7');
select ok(not has_table_privilege('authenticated', 'public.job', 'select'), 'authenticated cannot select job before M7');

select * from finish();
rollback;
