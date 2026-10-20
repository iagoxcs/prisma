-- Indicadores de projeto (REQUISITOS §9): views de agregação, só leitura.
-- security_invoker = true: valem as policies de projects e tasks de quem consulta (admin vê o portfólio;
-- os demais, só os projetos de que participam). Como tasks_select ainda devolve tarefas atribuídas ou
-- compartilhadas a externos, cada view filtra por is_internal(): externo, anon e perfil inativo recebem
-- 0 linhas (RF-22). O select força initplan (avaliado uma vez por consulta).
-- As views expõem só ids; nomes vêm de projects, categories e profiles no cliente (cada um com sua RLS).
-- Datas e semanas em America/Sao_Paulo. category_id nulo = "sem escopo"; assignee_id nulo = "sem responsável".
-- workload_by_assignee é parcial para quem não é admin: conta só as tarefas dos projetos visíveis ao usuário.

-- Conclusão e atrasadas por projeto (inclui projetos sem tarefas; completion_pct nulo nesse caso).
create view public.project_progress
with (security_invoker = true)
as
select
  p.id                                                        as project_id,
  count(t.id)                                                 as total,
  count(*) filter (where t.status = 'done')                   as done,
  count(*) filter (where t.status <> 'done')                  as open,
  count(*) filter (
    where t.status <> 'done'
      and t.due_date < (now() at time zone 'America/Sao_Paulo')::date
  )                                                           as overdue,
  round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(t.id), 0), 1) as completion_pct
from public.projects p
left join public.tasks t on t.project_id = p.id
where (select public.is_internal())
group by p.id;

-- Tarefas concluídas por semana (segunda-feira como início). Semanas sem conclusão não geram linha.
create view public.task_throughput_weekly
with (security_invoker = true)
as
select
  t.project_id,
  date_trunc('week', t.concluded_at at time zone 'America/Sao_Paulo')::date as week_start,
  count(*)                                                                  as done_count
from public.tasks t
where (select public.is_internal())
  and t.status = 'done'
  and t.concluded_at is not null
group by t.project_id, date_trunc('week', t.concluded_at at time zone 'America/Sao_Paulo')::date;

-- Lead time médio (dias entre criação e conclusão) por projeto e categoria.
create view public.task_lead_time
with (security_invoker = true)
as
select
  t.project_id,
  t.category_id,
  count(*) as tasks_done,
  round(avg(extract(epoch from (t.concluded_at - t.created_at)) / 86400)::numeric, 1) as avg_days
from public.tasks t
where (select public.is_internal())
  and t.status = 'done'
  and t.concluded_at is not null
group by t.project_id, t.category_id;

-- Aderência ao prazo: tarefas concluídas sem due_date ficam fora do denominador.
create view public.deadline_adherence
with (security_invoker = true)
as
select
  t.project_id,
  t.assignee_id,
  count(*) as done_total,
  count(*) filter (
    where (t.concluded_at at time zone 'America/Sao_Paulo')::date <= t.due_date
  )        as done_on_time
from public.tasks t
where (select public.is_internal())
  and t.status = 'done'
  and t.concluded_at is not null
  and t.due_date is not null
group by t.project_id, t.assignee_id;

-- Carga: tarefas abertas e atrasadas por responsável e projeto.
create view public.workload_by_assignee
with (security_invoker = true)
as
select
  t.assignee_id,
  t.project_id,
  count(*) as open_count,
  count(*) filter (where t.due_date < (now() at time zone 'America/Sao_Paulo')::date) as overdue_count
from public.tasks t
where (select public.is_internal())
  and t.status <> 'done'
group by t.assignee_id, t.project_id;

-- Distribuição por escopo (categoria) e status.
create view public.scope_distribution
with (security_invoker = true)
as
select
  t.project_id,
  t.category_id,
  t.status,
  count(*) as task_count
from public.tasks t
where (select public.is_internal())
group by t.project_id, t.category_id, t.status;

-- Só leitura, só para authenticated (anon sem acesso).
revoke all on public.project_progress        from public, anon, authenticated;
revoke all on public.task_throughput_weekly  from public, anon, authenticated;
revoke all on public.task_lead_time          from public, anon, authenticated;
revoke all on public.deadline_adherence      from public, anon, authenticated;
revoke all on public.workload_by_assignee    from public, anon, authenticated;
revoke all on public.scope_distribution      from public, anon, authenticated;
grant select on public.project_progress        to authenticated;
grant select on public.task_throughput_weekly  to authenticated;
grant select on public.task_lead_time          to authenticated;
grant select on public.deadline_adherence      to authenticated;
grant select on public.workload_by_assignee    to authenticated;
grant select on public.scope_distribution      to authenticated;
