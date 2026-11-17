-- task_indicator_facts.is_overdue nunca nulo: tarefa aberta sem prazo dava `true and null` = null.
-- Mesmo select de 20261021010439_task_indicator_facts.sql; só o is_overdue ganha coalesce(..., false).
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
where (select public.is_internal());

-- Só leitura, só para authenticated (anon sem acesso).
revoke all on public.task_indicator_facts from public, anon, authenticated;
grant select on public.task_indicator_facts to authenticated;
