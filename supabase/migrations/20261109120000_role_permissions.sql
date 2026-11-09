-- Permissões por perfil editáveis em Configurações → Perfis e permissões.
-- A tela grava em role_permissions; as policies consultam role_can(). A autorização segue no banco.
-- Seed = comportamento anterior: o deploy não muda o acesso de ninguém.
--
-- Fixos (não configuráveis): Administrador tem tudo; Externo não recebe nenhuma capacidade desta tabela;
-- o gestor do projeto (manager_id) mantém tudo no próprio projeto; visibilidade de projetos/tarefas,
-- comentários internos e Configurações seguem como antes.

-- ---------------------------------------------------------------------------
-- role_permissions
-- ---------------------------------------------------------------------------
create table public.role_permissions (
  role       public.user_role not null,
  permission text not null check (permission in (
    'project.create', 'scope.manage', 'task.create', 'task.edit_any', 'task.delete',
    'clients.view', 'clients.manage', 'knowledge.manage'
  )),
  allowed    boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (role, permission)
);
alter table public.role_permissions enable row level security;
create index role_permissions_updated_by_idx on public.role_permissions (updated_by);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (public.current_user_role() is not null);
create policy role_permissions_update on public.role_permissions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Só `allowed` é editável; as linhas nascem por migração.
revoke insert, delete, update on public.role_permissions from authenticated;
grant update (allowed) on public.role_permissions to authenticated;

insert into public.role_permissions (role, permission, allowed)
select r, p, case
    when r = 'admin' then true
    when r = 'externo' then false
    else (r, p) in (
      ('gerente', 'project.create'),
      ('lider', 'scope.manage'),
      ('gerente', 'task.create'), ('lider', 'task.create'), ('consultor', 'task.create'),
      ('lider', 'task.edit_any'),
      ('gerente', 'clients.view'), ('lider', 'clients.view'), ('consultor', 'clients.view'),
      ('gerente', 'clients.manage'),
      ('gerente', 'knowledge.manage')
    )
  end
from unnest(enum_range(null::public.user_role)) as r,
     unnest(array['project.create', 'scope.manage', 'task.create', 'task.edit_any', 'task.delete',
                  'clients.view', 'clients.manage', 'knowledge.manage']) as p;

create function public.role_permissions_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role in ('admin', 'externo') then
    raise exception 'As permissões do perfil % são fixas', old.role using errcode = '42501';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.role_permissions_before_update() from authenticated;

create trigger role_permissions_before_update
  before update on public.role_permissions
  for each row execute function public.role_permissions_before_update();

-- Auditoria: a troca aparece na aba Auditoria (entity_id/project_id ficam nulos).
create trigger role_permissions_activity after update on public.role_permissions
  for each row execute function public.log_activity();

-- ---------------------------------------------------------------------------
-- Helper: o perfil do usuário atual tem a capacidade? Admin sempre; inativo nunca.
-- ---------------------------------------------------------------------------
create function public.role_can(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or coalesce((
      select rp.allowed from public.role_permissions rp
      where rp.role = public.current_user_role() and rp.permission = perm
    ), false)
$$;
revoke execute on function public.role_can(text) from public, anon;
grant execute on function public.role_can(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers reescritos
-- ---------------------------------------------------------------------------
create or replace function public.can_create_in_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_project_manager(pid)
    or (public.role_can('task.create') and public.is_project_member(pid))
$$;

create or replace function public.can_edit_task(tid uuid)
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
        or (public.role_can('task.edit_any') and public.is_project_member(t.project_id))
        or t.assignee_id = auth.uid()
      )
  )
$$;

create or replace function public.can_manage_knowledge()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.role_can('knowledge.manage')
$$;

-- ---------------------------------------------------------------------------
-- Policies reescritas
-- ---------------------------------------------------------------------------
drop policy projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin() or (public.role_can('project.create') and manager_id = (select auth.uid())));

drop policy categories_insert on public.categories;
drop policy categories_update on public.categories;
drop policy categories_delete on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (public.is_project_manager(project_id) or (public.role_can('scope.manage') and public.is_project_member(project_id)));
create policy categories_update on public.categories for update to authenticated
  using (public.is_project_manager(project_id) or (public.role_can('scope.manage') and public.is_project_member(project_id)))
  with check (public.is_project_manager(project_id) or (public.role_can('scope.manage') and public.is_project_member(project_id)));
create policy categories_delete on public.categories for delete to authenticated
  using (public.is_project_manager(project_id) or (public.role_can('scope.manage') and public.is_project_member(project_id)));

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_edit_task(id))
  -- Avaliado sobre a linha nova: quem não edita qualquer tarefa só mantém as atribuídas a si.
  with check (
    public.is_project_manager(project_id)
    or (public.role_can('task.edit_any') and public.is_project_member(project_id))
    or assignee_id = (select auth.uid()));

drop policy tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.is_project_manager(project_id) or (public.role_can('task.delete') and public.is_project_member(project_id)));

-- Clientes: externos nunca (is_internal), mesmo que a linha mude no futuro.
drop policy clients_select on public.clients;
drop policy clients_insert on public.clients;
drop policy clients_update on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.is_internal() and public.role_can('clients.view'));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_internal() and public.role_can('clients.manage'));
create policy clients_update on public.clients for update to authenticated
  using (public.is_internal() and public.role_can('clients.manage'))
  with check (public.is_internal() and public.role_can('clients.manage'));
