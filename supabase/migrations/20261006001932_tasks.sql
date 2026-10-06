-- Fase 2 · Execução: categorias (escopos), tarefas, checklist, anexos, comentários.

create type public.task_status as enum ('todo', 'doing', 'done');

-- ---------------------------------------------------------------------------
-- categories (escopos do projeto — RF-02)
-- ---------------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null,
  color      text not null default '#64748b',
  created_at timestamptz not null default now(),
  unique (project_id, name)
);
alter table public.categories enable row level security;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  title        text not null,
  description  text,
  status       public.task_status not null default 'todo',
  assignee_id  uuid references public.profiles (id) on delete set null,
  start_date   date,
  due_date     date,
  concluded_at timestamptz,
  position     double precision not null default 0,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint tasks_dates_check check (due_date is null or start_date is null or due_date >= start_date)
);
alter table public.tasks enable row level security;
create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_assignee_idx on public.tasks (assignee_id);
create index tasks_due_date_idx on public.tasks (due_date) where status <> 'done';

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- concluded_at alimenta lead time e throughput (seção 9).
create function public.tasks_set_concluded_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.concluded_at = now();
    end if;
  else
    new.concluded_at = null;
  end if;
  return new;
end;
$$;

create trigger tasks_concluded_at
  before insert or update of status on public.tasks
  for each row execute function public.tasks_set_concluded_at();

-- Compartilhamento explícito de tarefa com externos (RF-21).
create table public.task_shares (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
alter table public.task_shares enable row level security;
create index task_shares_user_idx on public.task_shares (user_id);

-- ---------------------------------------------------------------------------
-- Helpers de acesso à tarefa
-- ---------------------------------------------------------------------------
-- Internos membros do projeto veem todas as tarefas; externos veem somente as
-- atribuídas a eles ou compartilhadas.
create function public.can_see_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = tid
      and public.is_project_member(t.project_id)
      and (
        public.is_internal()
        or t.assignee_id = auth.uid()
        or exists (select 1 from public.task_shares s where s.task_id = t.id and s.user_id = auth.uid())
      )
  )
$$;

-- Edita: gestão do projeto, líder membro, ou o responsável pela tarefa.
create function public.can_edit_task(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tasks t
    where t.id = tid
      and public.current_user_role() is not null
      and (
        public.is_project_manager(t.project_id)
        or (public.has_role('lider') and public.is_project_member(t.project_id))
        or t.assignee_id = auth.uid()
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- checklist_items
-- ---------------------------------------------------------------------------
create table public.checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.checklist_items enable row level security;
create index checklist_items_task_idx on public.checklist_items (task_id);

-- ---------------------------------------------------------------------------
-- task_attachments (arquivos no bucket privado `task-attachments`)
-- ---------------------------------------------------------------------------
create table public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 20971520), -- 20 MB (RF-09)
  mime_type    text,
  uploaded_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
alter table public.task_attachments enable row level security;
create index task_attachments_task_idx on public.task_attachments (task_id);

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null check (length(body) > 0),
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.comments enable row level security;
create index comments_task_idx on public.comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
-- categories
create policy categories_select on public.categories for select to authenticated
  using (public.is_project_member(project_id));
create policy categories_write on public.categories for all to authenticated
  using (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)))
  with check (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)));

-- tasks
create policy tasks_select on public.tasks for select to authenticated
  using (public.can_see_task(id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_create_in_project(project_id) and created_by = auth.uid());
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_edit_task(id))
  -- Avaliado sobre a linha nova: consultor/externo só mantêm tarefas atribuídas a si.
  with check (
    public.is_project_manager(project_id)
    or (public.has_role('lider') and public.is_project_member(project_id))
    or assignee_id = auth.uid()
  );
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_project_manager(project_id));

-- task_shares: quem edita a tarefa compartilha; o próprio usuário enxerga o que recebeu.
create policy task_shares_select on public.task_shares for select to authenticated
  using (user_id = auth.uid() or public.can_edit_task(task_id));
create policy task_shares_write on public.task_shares for all to authenticated
  using (public.can_edit_task(task_id) and public.is_internal())
  with check (public.can_edit_task(task_id) and public.is_internal());

-- checklist_items
create policy checklist_select on public.checklist_items for select to authenticated
  using (public.can_see_task(task_id));
create policy checklist_write on public.checklist_items for all to authenticated
  using (public.can_edit_task(task_id))
  with check (public.can_edit_task(task_id));

-- task_attachments
create policy attachments_select on public.task_attachments for select to authenticated
  using (public.can_see_task(task_id));
create policy attachments_insert on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id) and uploaded_by = auth.uid());
create policy attachments_delete on public.task_attachments for delete to authenticated
  using (
    uploaded_by = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id))
  );

-- comments: externos não veem nem criam comentários internos (RF-22).
create policy comments_select on public.comments for select to authenticated
  using (public.can_see_task(task_id) and (not is_internal or public.is_internal()));
create policy comments_insert on public.comments for insert to authenticated
  with check (
    public.can_see_task(task_id)
    and author_id = auth.uid()
    and (not is_internal or public.is_internal())
  );
create policy comments_update on public.comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and (not is_internal or public.is_internal()));
create policy comments_delete on public.comments for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id))
  );
