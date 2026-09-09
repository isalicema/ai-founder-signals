-- Explicit preference feedback must not be confused with content quality or
-- workflow state. Keep legacy values for historical provenance; new UI writes
-- like/dislike, while restoring an algorithmically folded item writes restored.
alter table public.feedback
  drop constraint if exists feedback_signal_check;

alter table public.feedback
  add constraint feedback_signal_check check (
    signal in (
      'irrelevant',
      'low_quality',
      'great',
      'opened_source',
      'archive_requested',
      'like',
      'dislike',
      'restored'
    )
  );
