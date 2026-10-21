-- Indicadores com filtros (RF-24): uma linha por tarefa, com projeto, escopo, responsável e datas já
-- resolvidas em America/Sao_Paulo, para a página filtrar por projeto, escopo, responsável e período.
-- Complementa as views agregadas de 20261020203101 (que seguem intactas).
-- security_invoker = true: valem as policies de tasks de quem consulta. Como tasks_select ainda devolve
-- tarefas atribuídas ou compartilhadas a externos, a view filtra por is_internal(): externo, anon e perfil
-- inativo recebem 0 linhas (RF-22). O select força initplan (avaliado uma vez por consulta).
--
-- concluded_on: dia da conclusão no fuso de Brasília (só tarefas done).
-- is_overdue:   tarefa aberta com prazo anterior a hoje (Brasília).
-- on_time:      tarefa done com prazo, concluída até o prazo; nulo se não done ou sem prazo.
-- lead_days:    dias entre criação e conclusão (só tarefas done).
create view public.task_indicator_facts
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
  (t.status <> 'done'
    and t.due_date < (now() at time zone 'America/Sao_Paulo')::date) as is_overdue,
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
