alter table public.source
  add column config jsonb;

alter table public.source
  drop constraint source_ingest_method_check;

alter table public.source
  add constraint source_ingest_method_check
  check (ingest_method in ('rss', 'youtube', 'podcast', 'html', 'json_api'));
