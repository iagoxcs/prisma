-- Módulo de Configurações: parâmetros do sistema (app_settings) e gestão de usuários mais segura.

-- ---------------------------------------------------------------------------
-- app_settings: chave/valor tipado, leitura por qualquer usuário ativo, escrita só admin.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create index app_settings_updated_by_idx on public.app_settings (updated_by);

create policy app_settings_select on public.app_settings for select to authenticated
  using (public.current_user_role() is not null);
create policy app_settings_update on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Só o valor é editável; chaves nascem por migração.
revoke insert, delete, update on public.app_settings from authenticated;
grant update (value) on public.app_settings to authenticated;

create function public.app_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value;
  item jsonb;
begin
  case new.key
    when 'organization_name' then
      if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 80 then
        raise exception 'organization_name: texto de 1 a 80 caracteres';
      end if;
    when 'deadline_warning_days' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric not between 0 and 14 then
        raise exception 'deadline_warning_days: inteiro de 0 a 14';
      end if;
    when 'notify_due_soon', 'notify_overdue' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception '%: verdadeiro ou falso', new.key;
      end if;
    when 'default_categories' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then
        raise exception 'default_categories: lista de até 20 nomes';
      end if;
      for item in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(item) <> 'string' or length(trim(item #>> '{}')) not between 1 and 40 then
          raise exception 'default_categories: cada nome deve ter de 1 a 40 caracteres';
        end if;
      end loop;
    else
      raise exception 'parâmetro desconhecido: %', new.key;
  end case;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_settings_validate
  before update on public.app_settings
  for each row execute function public.app_settings_before_update();

create trigger app_settings_activity
  after update on public.app_settings
  for each row execute function public.log_activity();

insert into public.app_settings (key, value, description) values
  ('organization_name',     '"Ambiente Consultoria"', 'Nome exibido no sistema'),
  ('deadline_warning_days', '1',                      'Dias de antecedência para o alerta de prazo próximo (0 = só no dia)'),
  ('notify_due_soon',       'true',                   'Gerar notificação de prazo próximo'),
  ('notify_overdue',        'true',                   'Gerar notificação de prazo vencido'),
  ('default_categories',    '[]',                     'Escopos criados automaticamente em cada novo projeto');

-- Alertas de prazo passam a respeitar os parâmetros.
create or replace function public.generate_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  warn_days integer := coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'deadline_warning_days'), 1);
  want_soon boolean := coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'notify_due_soon'), true);
  want_overdue boolean := coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'notify_overdue'), true);
  n integer := 0;
  c integer;
begin
  if want_soon then
    insert into public.notifications (user_id, type, entity_id, project_id, message)
    select t.assignee_id, 'due_soon', t.id, t.project_id,
           'Prazo próximo (' || to_char(t.due_date, 'DD/MM') || '): ' || t.title
    from public.tasks t
    join public.profiles u on u.id = t.assignee_id and u.active
    where t.status <> 'done' and t.due_date between today and today + warn_days
      and not exists (
        select 1 from public.notifications x
        where x.user_id = t.assignee_id and x.entity_id = t.id and x.type = 'due_soon'
          and x.message like '%(' || to_char(t.due_date, 'DD/MM') || ')%');
    get diagnostics c = row_count; n := n + c;
  end if;

  if want_overdue then
    insert into public.notifications (user_id, type, entity_id, project_id, message)
    select t.assignee_id, 'overdue', t.id, t.project_id,
           'Prazo vencido (' || to_char(t.due_date, 'DD/MM') || '): ' || t.title
    from public.tasks t
    join public.profiles u on u.id = t.assignee_id and u.active
    where t.status <> 'done' and t.due_date < today
      and not exists (
        select 1 from public.notifications x
        where x.user_id = t.assignee_id and x.entity_id = t.id and x.type = 'overdue'
          and x.message like '%(' || to_char(t.due_date, 'DD/MM') || ')%');
    get diagnostics c = row_count; n := n + c;
  end if;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Usuários: nunca deixar o sistema sem administrador ativo; edição de nome/cargo por admin.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_profile(
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
  if (new_role <> 'admin' or not new_active)
     and not exists (select 1 from public.profiles where role = 'admin' and active and id <> target) then
    raise exception 'o sistema precisa manter ao menos um administrador ativo' using errcode = 'P0001';
  end if;
  update public.profiles set role = new_role, active = new_active where id = target;
end;
$$;

create function public.admin_update_profile_details(target uuid, new_name text, new_job_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'apenas administradores podem alterar perfis' using errcode = '42501';
  end if;
  if length(trim(coalesce(new_name, ''))) = 0 then
    raise exception 'o nome é obrigatório';
  end if;
  update public.profiles
     set name = trim(new_name), job_title = nullif(trim(coalesce(new_job_title, '')), '')
   where id = target;
end;
$$;
revoke all on function public.admin_update_profile_details(uuid, text, text) from public, anon;
grant execute on function public.admin_update_profile_details(uuid, text, text) to authenticated;
revoke all on function public.app_settings_before_update() from public, anon, authenticated;
