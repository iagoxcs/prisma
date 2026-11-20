-- Verificação da tarefa cancelada (20261119230000 e 20261119230100).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261119_task_cancelled.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a2 gerente de b1 e responsável pelas tarefas.
-- Projeto b1 em andamento: d1 feita · d2 aberta atrasada · d3 cancelada atrasada · d4 cancelada sem prazo
-- · d5 aberta vencendo hoje · d6 cancelada vencendo hoje.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gerente@teste.local', '{"name":"Gerente"}');

update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000000a1' then 'admin'
  else 'gerente' end::public.user_role
where id::text like '00000000-0000-0000-0000-0000000000a%';

insert into public.projects (id, name, manager_id, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '00000000-0000-0000-0000-0000000000a2', 'em_andamento');

insert into public.tasks (id, project_id, title, status, assignee_id, due_date) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Feita', 'done', '00000000-0000-0000-0000-0000000000a2', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Aberta atrasada', 'todo', '00000000-0000-0000-0000-0000000000a2', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 'Cancelada atrasada', 'cancelled', '00000000-0000-0000-0000-0000000000a2', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', 'Cancelada sem prazo', 'cancelled', '00000000-0000-0000-0000-0000000000a2', null),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b1', 'Aberta hoje', 'doing', '00000000-0000-0000-0000-0000000000a2', (now() at time zone 'America/Sao_Paulo')::date),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000b1', 'Cancelada hoje', 'cancelled', '00000000-0000-0000-0000-0000000000a2', (now() at time zone 'America/Sao_Paulo')::date);

-- ---------------------------------------------------------------------------
-- Notificações (rodam como security definer): canceladas não geram aviso.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  delete from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a2';
  perform public.generate_deadline_notifications();
  select count(*) into n from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000a2'
    and entity_id in ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d6');
  if n <> 0 then raise exception 'PRAZOS: cancelada gerou % aviso(s)', n; end if;
  if not exists (select 1 from public.notifications where entity_id = '00000000-0000-0000-0000-0000000000d2' and type = 'overdue') then
    raise exception 'PRAZOS: aberta atrasada deveria gerar aviso de vencida';
  end if;
  if not exists (select 1 from public.notifications where entity_id = '00000000-0000-0000-0000-0000000000d5' and type = 'due_soon') then
    raise exception 'PRAZOS: aberta vencendo hoje deveria gerar aviso de prazo próximo';
  end if;

  -- Só d4 está sem prazo e ela é cancelada: o lembrete não sai.
  delete from public.notifications where type = 'missing_due_date';
  update public.app_settings set value = 'true' where key = 'notify_missing_due_date';
  n := public.generate_missing_due_date_notifications();
  if exists (select 1 from public.notifications where type = 'missing_due_date' and project_id = '00000000-0000-0000-0000-0000000000b1') then
    raise exception 'SEM PRAZO: cancelada sem prazo gerou lembrete';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Indicadores (security_invoker): admin vê o projeto sem as canceladas.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.project_progress where project_id = '00000000-0000-0000-0000-0000000000b1';
  if r.total <> 3 or r.done <> 1 or r.open <> 2 or r.overdue <> 1 or r.completion_pct <> 33.3 then
    raise exception 'PROGRESSO: esperava total 3, feitas 1, abertas 2, atrasadas 1, 33.3%%: %', r;
  end if;

  if (select count(*) from public.task_indicator_facts where project_id = '00000000-0000-0000-0000-0000000000b1') <> 3 then
    raise exception 'FATOS: canceladas deveriam ficar fora (esperava 3 tarefas)';
  end if;

  if (select sum(open_count) from public.workload_by_assignee where project_id = '00000000-0000-0000-0000-0000000000b1') <> 2 then
    raise exception 'CARGA: canceladas não são abertas (esperava 2)';
  end if;

  if exists (select 1 from public.scope_distribution where project_id = '00000000-0000-0000-0000-0000000000b1' and status = 'cancelled') then
    raise exception 'ESCOPO: distribuição não deveria ter canceladas';
  end if;
end $$;
reset role;

rollback;
