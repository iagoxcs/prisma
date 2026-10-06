create extension if not exists pg_cron;

-- Alertas de prazo (RF-18): "due_soon" (vence hoje ou amanhã) e "overdue" (venceu), uma vez por tarefa.
-- Datas em America/Sao_Paulo.
create function public.generate_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  n integer := 0;
  c integer;
begin
  insert into public.notifications (user_id, type, entity_id, project_id, message)
  select t.assignee_id, 'due_soon', t.id, t.project_id,
         'Prazo próximo (' || to_char(t.due_date, 'DD/MM') || '): ' || t.title
  from public.tasks t
  join public.profiles u on u.id = t.assignee_id and u.active
  where t.status <> 'done' and t.due_date between today and today + 1
    and not exists (
      select 1 from public.notifications x
      where x.user_id = t.assignee_id and x.entity_id = t.id and x.type = 'due_soon'
        and x.message like '%(' || to_char(t.due_date, 'DD/MM') || ')%');
  get diagnostics c = row_count; n := n + c;

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
  return n;
end;
$$;
revoke all on function public.generate_deadline_notifications() from public, anon, authenticated;

-- 08:00 em Brasília (11:00 UTC), todos os dias.
select cron.schedule('prisma-deadline-notifications', '0 11 * * *', $$select public.generate_deadline_notifications()$$);
