-- Higiene do projeto (O4): nos dias 1 e 15, às 08:00 (BRT), o gerente de cada projeto ativo recebe
-- uma notificação com a contagem de tarefas abertas sem prazo. Liga/desliga em app_settings.

-- ---------------------------------------------------------------------------
-- Novo tipo de notificação.
-- ---------------------------------------------------------------------------
alter table public.notifications
  drop constraint notifications_type_check,
  add constraint notifications_type_check
    check (type in ('task_assigned', 'due_soon', 'overdue', 'comment', 'mention', 'missing_due_date'));

-- ---------------------------------------------------------------------------
-- Parâmetro: liga/desliga o lembrete.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('notify_missing_due_date', 'true', 'Lembrar a cada 15 dias as tarefas sem prazo');

-- Cópia da versão de 20261020134510_deadline_emails.sql; só inclui a chave nova no ramo booleano.
create or replace function public.app_settings_before_update()
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
    when 'notify_due_soon', 'notify_overdue', 'email_deadline_alerts', 'notify_missing_due_date' then
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
revoke all on function public.app_settings_before_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Geração: uma notificação por projeto ativo com tarefa aberta sem prazo, para o gerente (perfil ativo).
-- ---------------------------------------------------------------------------
create function public.generate_missing_due_date_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not coalesce((select (value #>> '{}')::boolean from public.app_settings
                   where key = 'notify_missing_due_date'), true) then
    return 0;
  end if;

  insert into public.notifications (user_id, type, entity_type, entity_id, project_id, message)
  select p.manager_id, 'missing_due_date', 'project', p.id, p.id,
         c.n || ' tarefa(s) sem prazo em ' || p.name
  from public.projects p
  join public.profiles u on u.id = p.manager_id and u.active
  cross join lateral (
    select count(*) as n from public.tasks t
    where t.project_id = p.id and t.status <> 'done' and t.due_date is null) c
  where p.status in ('planejamento', 'em_andamento', 'pausado') and c.n > 0;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.generate_missing_due_date_notifications() from public, anon, authenticated;

-- Dias 1 e 15, 08:00 em Brasília (11:00 UTC).
select cron.schedule('prisma-missing-due-date', '0 11 1,15 * *',
                     $$select public.generate_missing_due_date_notifications()$$);

-- ---------------------------------------------------------------------------
-- Índice de pendências de e-mail passa a cobrir o tipo novo.
-- ---------------------------------------------------------------------------
drop index public.notifications_email_pending_idx;
create index notifications_email_pending_idx on public.notifications (created_at)
  where emailed_at is null and type in ('due_soon', 'overdue', 'missing_due_date');
