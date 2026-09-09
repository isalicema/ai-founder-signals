alter table public.item
  add column if not exists obsidian_path text;

comment on column public.item.obsidian_path is
  'Vault-relative Obsidian note path written when downstream deep-read archival completes';

alter table public.item
  add constraint item_obsidian_path_relative_check
  check (
    obsidian_path is null
    or (
      obsidian_path <> ''
      and obsidian_path not like '/%'
      and obsidian_path not like '../%'
      and obsidian_path not like '%/../%'
    )
  );
