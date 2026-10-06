-- Fase 1 · Fundação: perfis, clientes, projetos, membros + helpers de RLS.
-- Regra do projeto: toda tabela nasce com RLS habilitado (RNF-01).

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'gerente', 'lider', 'consultor', 'externo');
create type public.project_status as enum ('planejamento', 'em_andamento', 'pausado', 'concluido', 'cancelado');

-- ---------------------------------------------------------------------------
-- Utilitário: updated_at
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  job_title   text,
  role        public.user_role not null default 'externo',
  is_external boolean generated always as (role = 'externo') stored,
  active      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Todo novo usuário nasce inativo e sem privilégio; um admin ativa e define o perfil.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers de autorização (security definer: leem profiles sem recursão de RLS)
-- ---------------------------------------------------------------------------
create function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.has_role(r public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = r, false)
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('admin')
$$;

-- Perfil ativo e não externo.
create function public.is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('admin', 'gerente', 'lider', 'consultor'), false)
$$;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'ativo' check (status in ('ativo', 'inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.clients (id) on delete restrict,
  name       text not null,
  status     public.project_status not null default 'planejamento',
  manager_id uuid references public.profiles (id) on delete set null,
  start_date date,
  end_date   date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);
alter table public.projects enable row level security;
create index projects_client_idx on public.projects (client_id);
create index projects_manager_idx on public.projects (manager_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- project_members
-- ---------------------------------------------------------------------------
create table public.project_members (
  project_id   uuid not null references public.projects (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  project_role text not null default 'consultor'
    check (project_role in ('gerente', 'lider', 'consultor', 'externo')),
  created_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);
alter table public.project_members enable row level security;
create index project_members_user_idx on public.project_members (user_id);

-- ---------------------------------------------------------------------------
-- Helpers dependentes de projects / project_members
-- ---------------------------------------------------------------------------
create function public.is_project_manager(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      public.current_user_role() is not null
      and exists (select 1 from public.projects p where p.id = pid and p.manager_id = auth.uid())
    )
$$;

create function public.is_project_member(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_project_manager(pid)
    or (
      public.current_user_role() is not null
      and exists (
        select 1 from public.project_members m
        where m.project_id = pid and m.user_id = auth.uid()
      )
    )
$$;

-- Quem pode criar tarefas/relatórios no projeto: gestão do projeto ou membro interno
-- com perfil gerente, líder ou consultor. Externos nunca criam.
create function public.can_create_in_project(pid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_project_manager(pid)
    or (
      public.current_user_role() in ('gerente', 'lider', 'consultor')
      and public.is_project_member(pid)
    )
$$;

-- Usuário compartilha ao menos um projeto com o usuário informado (usado para que
-- externos enxerguem o nome de quem trabalha nos mesmos projetos).
create function public.shares_project_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members a
    join public.project_members b on b.project_id = a.project_id
    where a.user_id = auth.uid() and b.user_id = other
  )
$$;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------
-- profiles: internos veem o diretório; cada um vê o próprio; externos veem
-- apenas colegas de projeto. Edição direta limitada a nome/cargo (grants abaixo);
-- mudança de perfil/ativação só via admin_update_profile().
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_internal()
    or public.shares_project_with(id)
  );

create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (name, job_title) on public.profiles to authenticated;

create function public.admin_update_profile(
  target uuid,
  new_role public.user_role,
  new_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'apenas administradores podem alterar perfis' using errcode = '42501';
  end if;
  update public.profiles set role = new_role, active = new_active where id = target;
end;
$$;
revoke all on function public.admin_update_profile(uuid, public.user_role, boolean) from public, anon;
grant execute on function public.admin_update_profile(uuid, public.user_role, boolean) to authenticated;

-- clients: apenas internos.
create policy clients_select on public.clients for select to authenticated
  using (public.is_internal());
create policy clients_insert on public.clients for insert to authenticated
  with check (public.has_role('admin') or public.has_role('gerente'));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role('admin') or public.has_role('gerente'))
  with check (public.has_role('admin') or public.has_role('gerente'));
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_admin());

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.is_project_member(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (
    public.is_admin()
    or (public.has_role('gerente') and manager_id = auth.uid())
  );
create policy projects_update on public.projects for update to authenticated
  using (public.is_project_manager(id))
  with check (public.is_admin() or manager_id = auth.uid());
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_admin());

-- project_members: leitura por membros; gestão pelo gerente do projeto/admin.
create policy project_members_select on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy project_members_insert on public.project_members for insert to authenticated
  with check (public.is_project_manager(project_id));
create policy project_members_update on public.project_members for update to authenticated
  using (public.is_project_manager(project_id))
  with check (public.is_project_manager(project_id));
create policy project_members_delete on public.project_members for delete to authenticated
  using (public.is_project_manager(project_id));
