-- Verificação das views de indicadores de projeto (20261020203101_project_indicators_views.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261020_rls_project_indicators.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a2 gerente do projeto b1 · a3 consultor membro de b1 (não de b2) · a4 consultor não-membro · a5 externo membro de b1.
-- Projetos: b1 (com tarefas), b2 (só admin; tarefa atrasada de a3), b3 (sem tarefas).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gerente@teste.local', '{"name":"Gerente"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'consultor@teste.local', '{"name":"Consultor"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'naomembro@teste.local', '{"name":"Nao Membro"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'externo@teste.local', '{"name":"Externo"}');

update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000000a1' then 'admin'
  when '00000000-0000-0000-0000-0000000000a2' then 'gerente'
  when '00000000-0000-0000-0000-0000000000a3' then 'consultor'
  when '00000000-0000-0000-0000-0000000000a4' then 'consultor'
  else 'externo' end::public.user_role
where id::text like '00000000-0000-0000-0000-0000000000a%';

insert into public.projects (id, name, manager_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b2', 'Projeto B2', null),
  ('00000000-0000-0000-0000-0000000000b3', 'Projeto B3 (vazio)', null);
insert into public.project_members (project_id, user_id, project_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'consultor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a5', 'externo');
insert into public.categories (id, project_id, name)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Escopo 1');

-- d1 e d2: concluídas com escopo e responsável a3. d3: concluída sem prazo e sem escopo.
-- d4: aberta atrasada · d5: aberta sem prazo · d7: aberta do externo · d6 (b2): aberta atrasada de a3.
insert into public.tasks (id, project_id, category_id, title, status, assignee_id, due_date) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'Concluída no prazo (fuso)', 'done', '00000000-0000-0000-0000-0000000000a3', '2026-03-10'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'Concluída atrasada', 'done', '00000000-0000-0000-0000-0000000000a3', '2026-03-10'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', null, 'Concluída sem prazo', 'done', '00000000-0000-0000-0000-0000000000a3', null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta atrasada', 'todo', '00000000-0000-0000-0000-0000000000a3', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta sem prazo', 'todo', '00000000-0000-0000-0000-0000000000a3', null),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta do externo', 'todo', '00000000-0000-0000-0000-0000000000a5', null),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000b2', null, 'Atrasada em B2', 'todo', '00000000-0000-0000-0000-0000000000a3', '2020-01-01');
-- d1 conclui 23:30 de Brasília do dia do prazo (02:30 UTC do dia seguinte): no prazo só com o fuso certo.
update public.tasks set created_at = '2026-03-08 12:00+00', concluded_at = '2026-03-11 02:30+00' where id = '00000000-0000-0000-0000-0000000000d1';
update public.tasks set created_at = '2026-03-09 12:00+00', concluded_at = '2026-03-12 12:00+00' where id = '00000000-0000-0000-0000-0000000000d2';

-- ---------------------------------------------------------------------------
-- admin: portfólio completo
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare b1 uuid := '00000000-0000-0000-0000-0000000000b1'; r record;
begin
  if (select count(*) from public.project_progress where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 3 then
    raise exception 'ADMIN: project_progress deveria ter 3 projetos (inclui o sem tarefas)';
  end if;
  select * into r from public.project_progress where project_id = b1;
  if r.total <> 6 or r.done <> 3 or r.open <> 3 or r.overdue <> 1 or r.completion_pct <> 50.0 then
    raise exception 'ADMIN: project_progress B1 incorreto: %', r;
  end if;
  if (select completion_pct from public.project_progress where project_id = '00000000-0000-0000-0000-0000000000b3') is not null then
    raise exception 'ADMIN: completion_pct deveria ser nulo em projeto sem tarefas';
  end if;
  if (select done_count from public.task_throughput_weekly where project_id = b1 and week_start = '2026-03-09') <> 2 then
    raise exception 'ADMIN: throughput da semana de 2026-03-09 deveria ser 2';
  end if;
  select * into r from public.task_lead_time where project_id = b1 and category_id = '00000000-0000-0000-0000-0000000000f1';
  if r.tasks_done <> 2 or r.avg_days <> 2.8 then raise exception 'ADMIN: lead time do escopo incorreto: %', r; end if;
  if (select tasks_done from public.task_lead_time where project_id = b1 and category_id is null) <> 1 then
    raise exception 'ADMIN: lead time "sem escopo" deveria ter 1 tarefa';
  end if;
  select * into r from public.deadline_adherence where project_id = b1 and assignee_id = '00000000-0000-0000-0000-0000000000a3';
  if r.done_total <> 2 or r.done_on_time <> 1 then raise exception 'ADMIN: aderência incorreta (sem prazo fora; fuso SP): %', r; end if;
  if (select count(*) from public.workload_by_assignee where assignee_id = '00000000-0000-0000-0000-0000000000a3') <> 2 then
    raise exception 'ADMIN: carga de a3 deveria ter 2 linhas (b1 e b2)';
  end if;
  if (select sum(open_count) from public.workload_by_assignee where assignee_id = '00000000-0000-0000-0000-0000000000a3') <> 3 then
    raise exception 'ADMIN: carga total de a3 deveria ser 3';
  end if;
  if (select task_count from public.scope_distribution where project_id = b1 and category_id = '00000000-0000-0000-0000-0000000000f1' and status = 'done') <> 2 then
    raise exception 'ADMIN: distribuição do escopo 1 (done) deveria ser 2';
  end if;
  if (select task_count from public.scope_distribution where project_id = b1 and category_id is null and status = 'todo') <> 3 then
    raise exception 'ADMIN: distribuição "sem escopo" (todo) deveria ser 3';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- gerente de B1: só B1
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_progress where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 1 then
    raise exception 'GERENTE: deveria ver só o projeto que gerencia';
  end if;
  if exists (select 1 from public.workload_by_assignee where project_id = '00000000-0000-0000-0000-0000000000b2') then
    raise exception 'GERENTE: viu carga de projeto alheio';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- consultor membro de B1: só B1; carga por responsável é PARCIAL (b2 fica de fora)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_progress where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 1 then
    raise exception 'CONSULTOR: deveria ver só B1';
  end if;
  if (select count(*) from public.workload_by_assignee where assignee_id = '00000000-0000-0000-0000-0000000000a3') <> 1
     or (select sum(open_count) from public.workload_by_assignee where assignee_id = '00000000-0000-0000-0000-0000000000a3') <> 2 then
    raise exception 'CONSULTOR: carga de a3 deveria ser parcial (2 abertas em B1; a tarefa de B2 não aparece)';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- não-membro e externo: 0 linhas em todas as views (RF-22)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v text; n bigint;
begin
  foreach v in array array['project_progress','task_throughput_weekly','task_lead_time','deadline_adherence','workload_by_assignee','scope_distribution'] loop
    execute format('select count(*) from public.%I', v) into n;
    if n <> 0 then raise exception 'NÃO-MEMBRO: % deveria ter 0 linhas (tem %)', v, n; end if;
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v text; n bigint;
begin
  -- Pré-condição: a RLS de tasks sozinha deixa o externo ver a tarefa atribuída a ele.
  if (select count(*) from public.tasks where id = '00000000-0000-0000-0000-0000000000d7') <> 1 then
    raise exception 'EXTERNO: pré-condição falhou (deveria ver a própria tarefa em tasks)';
  end if;
  foreach v in array array['project_progress','task_throughput_weekly','task_lead_time','deadline_adherence','workload_by_assignee','scope_distribution'] loop
    execute format('select count(*) from public.%I', v) into n;
    if n <> 0 then raise exception 'EXTERNO: % deveria ter 0 linhas (tem %)', v, n; end if;
  end loop;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- anon: sem privilégio
-- ---------------------------------------------------------------------------
set local role anon;
do $$
declare v text;
begin
  foreach v in array array['project_progress','task_throughput_weekly','task_lead_time','deadline_adherence','workload_by_assignee','scope_distribution'] loop
    begin
      execute format('select 1 from public.%I', v);
      raise exception 'ANON: % não deveria ser acessível', v;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;
reset role;

rollback;
