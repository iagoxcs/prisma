-- Minhas Tarefas: kanban individual, sem vínculo a projeto. Só o dono enxerga e altera as próprias linhas.

create table public.personal_tasks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null check (length(btrim(title)) > 0),
  status     public.task_status not null default 'todo',
  due_date   date,
  position   double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.personal_tasks enable row level security;
create index personal_tasks_owner_status_idx on public.personal_tasks (owner_id, status);

create trigger personal_tasks_set_updated_at
  before update on public.personal_tasks
  for each row execute function public.set_updated_at();

-- (select auth.uid()) é avaliado uma vez por consulta (initplan).
create policy personal_tasks_select on public.personal_tasks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy personal_tasks_insert on public.personal_tasks
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy personal_tasks_update on public.personal_tasks
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy personal_tasks_delete on public.personal_tasks
  for delete to authenticated using (owner_id = (select auth.uid()));
