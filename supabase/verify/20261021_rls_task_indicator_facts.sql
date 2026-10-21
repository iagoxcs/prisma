-- Verificação da view task_indicator_facts (20261021010439_task_indicator_facts.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261021_rls_task_indicator_facts.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a2 gerente do projeto b1 · a3 consultor membro de b1 (não de b2) · a4 consultor não-membro · a5 externo membro de b1.
-- Projetos: b1 (com tarefas) e b2 (só admin).

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
  ('00000000-0000-0000-0000-0000000000b2', 'Projeto B2', null);
insert into public.project_members (project_id, user_id, project_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'consultor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a5', 'externo');
insert into public.categories (id, project_id, name)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Escopo 1');

-- d1: concluída 23:30 de Brasília do dia do prazo · d2: concluída atrasada · d3: concluída sem prazo
-- d4: aberta atrasada · d5: aberta sem prazo · d7: aberta do externo · d6 (b2): aberta atrasada.
insert into public.tasks (id, project_id, category_id, title, status, assignee_id, due_date) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'Concluída no prazo (fuso)', 'done', '00000000-0000-0000-0000-0000000000a3', '2026-03-10'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1', 'Concluída atrasada', 'done', '00000000-0000-0000-0000-0000000000a3', '2026-03-10'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', null, 'Concluída sem prazo', 'done', '00000000-0000-0000-0000-0000000000a3', null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta atrasada', 'todo', '00000000-0000-0000-0000-0000000000a3', '2020-01-01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta sem prazo', 'todo', '00000000-0000-0000-0000-0000000000a3', null),
  ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b1', null, 'Aberta do externo', 'todo', '00000000-0000-0000-0000-0000000000a5', null),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000b2', null, 'Atrasada em B2', 'todo', '00000000-0000-0000-0000-0000000000a3', '2020-01-01');
update public.tasks set created_at = '2026-03-08 12:00+00', concluded_at = '2026-03-11 02:30+00' where id = '00000000-0000-0000-0000-0000000000d1';
update public.tasks set created_at = '2026-03-09 12:00+00', concluded_at = '2026-03-12 12:00+00' where id = '00000000-0000-0000-0000-0000000000d2';

-- ---------------------------------------------------------------------------
-- admin: todas as tarefas, com os campos derivados corretos
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r record;
begin
  if (select count(*) from public.task_indicator_facts where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 7 then
    raise exception 'ADMIN: deveria ver as 7 tarefas de teste';
  end if;
  select * into r from public.task_indicator_facts where task_id = '00000000-0000-0000-0000-0000000000d1';
  if r.concluded_on <> '2026-03-10' or r.on_time is not true or r.lead_days <> 2.60 or r.is_overdue then
    raise exception 'ADMIN: d1 (23h30 de Brasília no dia do prazo) incorreta: %', r;
  end if;
  select * into r from public.task_indicator_facts where task_id = '00000000-0000-0000-0000-0000000000d2';
  if r.concluded_on <> '2026-03-12' or r.on_time is not false or r.lead_days <> 3.00 then
    raise exception 'ADMIN: d2 (concluída atrasada) incorreta: %', r;
  end if;
  select * into r from public.task_indicator_facts where task_id = '00000000-0000-0000-0000-0000000000d3';
  if r.on_time is not null or r.concluded_on is null then raise exception 'ADMIN: d3 (sem prazo) deveria ter on_time nulo: %', r; end if;
  select * into r from public.task_indicator_facts where task_id = '00000000-0000-0000-0000-0000000000d4';
  if r.is_overdue is not true or r.concluded_on is not null or r.on_time is not null or r.lead_days is not null then
    raise exception 'ADMIN: d4 (aberta atrasada) incorreta: %', r;
  end if;
  select * into r from public.task_indicator_facts where task_id = '00000000-0000-0000-0000-0000000000d5';
  if r.is_overdue is not false then raise exception 'ADMIN: d5 (aberta sem prazo) não é atrasada: %', r; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- gerente de B1 e consultor membro: só tarefas de B1 (6); b2 fica de fora
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.task_indicator_facts where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 6 then
    raise exception 'GERENTE: deveria ver só as 6 tarefas de B1';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.task_indicator_facts where project_id::text like '00000000-0000-0000-0000-0000000000b%') <> 6 then
    raise exception 'CONSULTOR: deveria ver só as 6 tarefas de B1';
  end if;
  if exists (select 1 from public.task_indicator_facts where project_id = '00000000-0000-0000-0000-0000000000b2') then
    raise exception 'CONSULTOR: viu tarefa de projeto alheio';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- não-membro e externo: 0 linhas (RF-22)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.task_indicator_facts) <> 0 then raise exception 'NÃO-MEMBRO: deveria ver 0 linhas'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  -- Pré-condição: a RLS de tasks sozinha deixa o externo ver a tarefa atribuída a ele.
  if (select count(*) from public.tasks where id = '00000000-0000-0000-0000-0000000000d7') <> 1 then
    raise exception 'EXTERNO: pré-condição falhou (deveria ver a própria tarefa em tasks)';
  end if;
  if (select count(*) from public.task_indicator_facts) <> 0 then raise exception 'EXTERNO: deveria ver 0 linhas'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- anon: sem privilégio
-- ---------------------------------------------------------------------------
set local role anon;
do $$ begin
  perform 1 from public.task_indicator_facts;
  raise exception 'ANON: a view não deveria ser acessível';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
