-- project_updates: registro periódico da saúde do projeto (imutável, como reports).
create type public.project_health as enum ('on_track', 'at_risk', 'off_track');

create table public.project_updates (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  health     public.project_health not null,
  body       text not null,
  author_id  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.project_updates enable row level security;
create index project_updates_project_created_idx
  on public.project_updates (project_id, created_at desc);

-- Leitura: membros internos do projeto. Escrita: só inserção pelo próprio autor.
-- Sem UPDATE/DELETE para usuários comuns; correções apenas pelo admin.
create policy project_updates_select on public.project_updates for select to authenticated
  using (public.is_project_member(project_id) and public.is_internal());
create policy project_updates_insert on public.project_updates for insert to authenticated
  with check (
    public.is_internal()
    and public.can_create_in_project(project_id)
    and author_id = auth.uid()
  );
create policy project_updates_update on public.project_updates for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy project_updates_delete on public.project_updates for delete to authenticated
  using (public.is_admin());
