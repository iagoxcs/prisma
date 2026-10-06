-- Storage de anexos, notificações, relatórios, logs de auditoria e realtime.

-- ---------------------------------------------------------------------------
-- Storage: bucket privado, 20 MB (RNF-03). Caminho: {project_id}/{task_id}/{arquivo}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

-- O segundo segmento do caminho é o id da tarefa; a regra de acesso é a da tarefa.
create function public.attachment_task_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (string_to_array(object_name, '/'))[2]::uuid;
exception when others then
  return null;
end;
$$;

create policy attachments_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'task-attachments' and public.can_see_task(public.attachment_task_id(name)));
create policy attachments_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-attachments' and public.can_see_task(public.attachment_task_id(name)));
create policy attachments_storage_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and (owner = auth.uid() or public.can_edit_task(public.attachment_task_id(name)))
  );

-- ---------------------------------------------------------------------------
-- notifications (RF-17..19) — cada usuário vê só as suas; escrita via triggers/Edge Functions
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('task_assigned', 'due_soon', 'overdue', 'comment', 'mention')),
  entity_type text not null default 'task',
  entity_id   uuid not null,
  project_id  uuid,
  message     text not null,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index notifications_user_idx on public.notifications (user_id, read, created_at desc);

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- Só o campo `read` é editável pelo usuário.
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- Gatilho: tarefa atribuída.
create function public.notify_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignee_id is not null
     and new.assignee_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications (user_id, type, entity_id, project_id, message)
    values (new.assignee_id, 'task_assigned', new.id, new.project_id, 'Tarefa atribuída a você: ' || new.title);
  end if;
  return new;
end;
$$;

create trigger tasks_notify_assigned
  after insert or update of assignee_id on public.tasks
  for each row execute function public.notify_task_assigned();

-- Gatilho: novo comentário (responsável e criador da tarefa, exceto o autor;
-- comentários internos nunca notificam externos).
create function public.notify_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = new.task_id;

  insert into public.notifications (user_id, type, entity_id, project_id, message)
  select distinct u.id, 'comment', t.id, t.project_id, 'Novo comentário em: ' || t.title
  from public.profiles u
  where u.id in (t.assignee_id, t.created_by)
    and u.id is distinct from new.author_id
    and u.active
    and (not new.is_internal or not u.is_external);
  return new;
end;
$$;

create trigger comments_notify
  after insert on public.comments
  for each row execute function public.notify_comment();

-- ---------------------------------------------------------------------------
-- reports — versionados e imutáveis (RF-05); HTML é renderizado em iframe sandbox (RNF-05)
-- ---------------------------------------------------------------------------
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects (id) on delete cascade, -- null = portfólio
  type            text not null check (type in ('one_page', 'status', 'indicadores')),
  version         integer not null default 1,
  title           text not null,
  html            text not null,
  generated_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  generated_by_ai boolean not null default false,
  created_at      timestamptz not null default now(),
  unique nulls not distinct (project_id, type, version)
);
alter table public.reports enable row level security;

create function public.reports_set_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select coalesce(max(version), 0) + 1 into new.version
  from public.reports
  where project_id is not distinct from new.project_id and type = new.type;
  return new;
end;
$$;

create trigger reports_version
  before insert on public.reports
  for each row execute function public.reports_set_version();

create policy reports_select on public.reports for select to authenticated
  using (
    public.is_internal()
    and (
      (project_id is not null and public.is_project_member(project_id))
      or (project_id is null and public.is_admin())
    )
  );
create policy reports_insert on public.reports for insert to authenticated
  with check (
    generated_by = auth.uid()
    and (
      (project_id is not null and public.can_create_in_project(project_id))
      or (project_id is null and public.is_admin())
    )
  );
create policy reports_delete on public.reports for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- ai_actions_log — escrito apenas pela Edge Function (service_role); leitura própria/admin
-- ---------------------------------------------------------------------------
create table public.ai_actions_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles (id) on delete set null,
  tool       text not null,
  input      jsonb,
  result     jsonb,
  created_at timestamptz not null default now()
);
alter table public.ai_actions_log enable row level security;
create index ai_actions_log_user_idx on public.ai_actions_log (user_id, created_at desc);

create policy ai_actions_log_select on public.ai_actions_log for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- activity_log — preenchido por trigger; sem políticas de escrita (imutável para usuários)
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  entity     text not null,
  entity_id  uuid,
  action     text not null,
  user_id    uuid,
  project_id uuid, -- sem FK: o log sobrevive à exclusão do projeto
  diff       jsonb,
  created_at timestamptz not null default now()
);
alter table public.activity_log enable row level security;
create index activity_log_project_idx on public.activity_log (project_id, created_at desc);

create policy activity_log_select on public.activity_log for select to authenticated
  using (
    public.is_admin()
    or (project_id is not null and public.is_internal() and public.is_project_member(project_id))
  );

create function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.activity_log (entity, entity_id, action, user_id, project_id, diff)
  values (
    tg_table_name,
    nullif(r ->> 'id', '')::uuid,
    lower(tg_op),
    auth.uid(),
    case tg_table_name when 'projects' then nullif(r ->> 'id', '')::uuid
                       else nullif(r ->> 'project_id', '')::uuid end,
    case tg_op when 'INSERT' then jsonb_build_object('new', to_jsonb(new))
               when 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
               else jsonb_build_object('old', to_jsonb(old)) end
  );
  return coalesce(new, old);
end;
$$;

create trigger projects_activity after insert or update or delete on public.projects
  for each row execute function public.log_activity();
create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function public.log_activity();
create trigger project_members_activity after insert or update or delete on public.project_members
  for each row execute function public.log_activity();

-- ---------------------------------------------------------------------------
-- Realtime (Kanban, comentários, notificações) — respeita RLS
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.tasks, public.comments, public.notifications;
