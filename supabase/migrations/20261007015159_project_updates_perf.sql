-- Ajuste pós-advisors em project_updates.
-- 1) auth.uid() em subselect (initplan).
drop policy project_updates_insert on public.project_updates;
create policy project_updates_insert on public.project_updates for insert to authenticated
  with check (
    public.is_internal()
    and public.can_create_in_project(project_id)
    and author_id = (select auth.uid())
  );

-- 2) índice de FK
create index if not exists project_updates_author_idx on public.project_updates (author_id);
