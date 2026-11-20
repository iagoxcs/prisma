-- Tarefa cancelada (P2): não é aberta nem feita. Fica fora de prazos, avisos, e-mails, atraso,
-- lembrete de tarefas sem prazo e do total dos indicadores (decisão de 19/11/2026).
-- Cada objeto abaixo repete a versão vigente e só troca o filtro de status.

-- Índice parcial de prazos: só tarefas abertas.
drop index if exists public.tasks_due_date_idx;
create index tasks_due_date_idx on public.tasks (due_date) where status not in ('done', 'cancelled');

-- Alertas de prazo (versão de 20261006014752_settings_module.sql).
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
    where t.status not in ('done', 'cancelled') and t.due_date between today and today + warn_days
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
    where t.status not in ('done', 'cancelled') and t.due_date < today
      and not exists (
        select 1 from public.notifications x
        where x.user_id = t.assignee_id and x.entity_id = t.id and x.type = 'overdue'
          and x.message like '%(' || to_char(t.due_date, 'DD/MM') || ')%');
    get diagnostics c = row_count; n := n + c;
  end if;
  return n;
end;
$$;

-- Lembrete de tarefas sem prazo (versão de 20261117204323_missing_due_date.sql).
create or replace function public.generate_missing_due_date_notifications()
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
    where t.project_id = p.id and t.status not in ('done', 'cancelled') and t.due_date is null) c
  where p.status in ('planejamento', 'em_andamento', 'pausado') and c.n > 0;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.generate_missing_due_date_notifications() from public, anon, authenticated;

-- Conclusão e atrasadas por projeto: canceladas fora do total, das abertas e do percentual.
create or replace view public.project_progress
with (security_invoker = true)
as
select
  p.id                                                          as project_id,
  count(t.id) filter (where t.status <> 'cancelled')            as total,
  count(*) filter (where t.status = 'done')                     as done,
  count(*) filter (where t.status not in ('done', 'cancelled')) as open,
  count(*) filter (
    where t.status not in ('done', 'cancelled')
      and t.due_date < (now() at time zone 'America/Sao_Paulo')::date
  )                                                             as overdue,
  round(100.0 * count(*) filter (where t.status = 'done')
        / nullif(count(t.id) filter (where t.status <> 'cancelled'), 0), 1) as completion_pct
from public.projects p
left join public.tasks t on t.project_id = p.id
where (select public.is_internal())
group by p.id;

-- Carga: tarefas abertas e atrasadas por responsável e projeto.
create or replace view public.workload_by_assignee
with (security_invoker = true)
as
select
  t.assignee_id,
  t.project_id,
  count(*) as open_count,
  count(*) filter (where t.due_date < (now() at time zone 'America/Sao_Paulo')::date) as overdue_count
from public.tasks t
where (select public.is_internal())
  and t.status not in ('done', 'cancelled')
group by t.assignee_id, t.project_id;

-- Distribuição por escopo e status: canceladas não entram.
create or replace view public.scope_distribution
with (security_invoker = true)
as
select
  t.project_id,
  t.category_id,
  t.status,
  count(*) as task_count
from public.tasks t
where (select public.is_internal())
  and t.status <> 'cancelled'
group by t.project_id, t.category_id, t.status;

-- Fatos por tarefa (versão de 20261117212157_task_indicator_facts_overdue.sql): canceladas não entram.
create or replace view public.task_indicator_facts
with (security_invoker = true)
as
select
  t.id                                                        as task_id,
  t.project_id,
  t.category_id,
  t.assignee_id,
  t.status,
  t.due_date,
  case when t.status = 'done'
    then (t.concluded_at at time zone 'America/Sao_Paulo')::date
  end                                                         as concluded_on,
  coalesce(t.status <> 'done'
    and t.due_date < (now() at time zone 'America/Sao_Paulo')::date, false) as is_overdue,
  case when t.status = 'done' and t.concluded_at is not null and t.due_date is not null
    then (t.concluded_at at time zone 'America/Sao_Paulo')::date <= t.due_date
  end                                                         as on_time,
  case when t.status = 'done' and t.concluded_at is not null
    then round((extract(epoch from (t.concluded_at - t.created_at)) / 86400)::numeric, 2)
  end                                                         as lead_days
from public.tasks t
where (select public.is_internal())
  and t.status <> 'cancelled';
