-- Contexto do projeto: transcrições, atas e anotações de reuniões.
-- Restrito a internos membros do projeto (is_project_member já inclui admin via is_project_manager).
-- Externos membros do projeto: 0 linhas.

create table public.project_context_entries (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  kind             text not null check (kind in ('transcricao', 'ata', 'anotacao')),
  title            text not null check (char_length(title) between 1 and 200),
  meeting_date     date,
  participants     text check (char_length(participants) <= 1000),
  body             text not null check (char_length(body) between 1 and 500000),
  source_file_name text,
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  search           tsvector generated always as (
    setweight(to_tsvector('portuguese'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('portuguese'::regconfig, coalesce(body, '')), 'B')
  ) stored
);
alter table public.project_context_entries enable row level security;
create index project_context_entries_search_idx on public.project_context_entries using gin (search);
create index project_context_entries_project_date_idx
  on public.project_context_entries (project_id, meeting_date desc nulls last);
create index project_context_entries_created_by_idx on public.project_context_entries (created_by);

create trigger project_context_entries_set_updated_at
  before update on public.project_context_entries
  for each row execute function public.set_updated_at();

create trigger project_context_entries_activity after insert or update or delete on public.project_context_entries
  for each row execute function public.log_activity();

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
create policy project_context_select on public.project_context_entries for select to authenticated
  using (public.is_internal() and public.is_project_member(project_id));
create policy project_context_insert on public.project_context_entries for insert to authenticated
  with check (
    public.is_internal()
    and public.is_project_member(project_id)
    and created_by = (select auth.uid())
  );
create policy project_context_update on public.project_context_entries for update to authenticated
  using (
    public.is_internal()
    and public.is_project_member(project_id)
    and (created_by = (select auth.uid()) or public.is_project_manager(project_id))
  )
  with check (
    public.is_internal()
    and public.is_project_member(project_id)
    and (created_by = (select auth.uid()) or public.is_project_manager(project_id))
  );
create policy project_context_delete on public.project_context_entries for delete to authenticated
  using (
    public.is_internal()
    and public.is_project_member(project_id)
    and (created_by = (select auth.uid()) or public.is_project_manager(project_id))
  );
