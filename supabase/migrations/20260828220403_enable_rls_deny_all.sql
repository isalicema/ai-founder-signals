-- Remote history split RLS hardening into its own migration. These statements
-- are intentionally idempotent with the canonical initial migration above.
alter table public.source   enable row level security;
alter table public.item     enable row level security;
alter table public.entity   enable row level security;
alter table public.feedback enable row level security;
alter table public.job      enable row level security;

revoke all on table public.source, public.item, public.entity, public.feedback, public.job
  from anon, authenticated;
revoke all on sequence public.feedback_id_seq, public.job_id_seq
  from anon, authenticated;
