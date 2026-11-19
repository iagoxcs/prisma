-- Verificação do bloqueio de troca de projeto da tarefa (20261119135308_tasks_lock_project.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261119_tasks_lock_project.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a2 gerente (gestor de b1 e b2) · a3 consultor membro de b1 e b2, responsável por d1.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gerente@teste.local', '{"name":"Gerente"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'consultor@teste.local', '{"name":"Consultor"}');

update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000000a1' then 'admin'
  when '00000000-0000-0000-0000-0000000000a2' then 'gerente'
  else 'consultor' end::public.user_role
where id::text like '00000000-0000-0000-0000-0000000000a%';

insert into public.projects (id, name, manager_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b2', 'Projeto B2', '00000000-0000-0000-0000-0000000000a2');
insert into public.project_members (project_id, user_id, project_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'consultor'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a3', 'consultor');
insert into public.tasks (id, project_id, title, created_by, assignee_id, status) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Tarefa D1',
   '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', 'todo');

-- ---------------------------------------------------------------------------
-- consultor responsável: não move a tarefa; troca o status
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  begin
    update public.tasks set project_id = '00000000-0000-0000-0000-0000000000b2'
    where id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'CONSULTOR: moveu a tarefa para outro projeto';
  exception when insufficient_privilege then
    if sqlerrm <> 'Não é possível mover a tarefa para outro projeto.' then
      raise exception 'CONSULTOR: mensagem inesperada: %', sqlerrm;
    end if;
  end;

  update public.tasks set status = 'doing' where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONSULTOR: não trocou o status da tarefa atribuída'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- service_role: também bloqueado
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    update public.tasks set project_id = '00000000-0000-0000-0000-0000000000b2'
    where id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'SERVICE_ROLE: moveu a tarefa para outro projeto';
  exception when insufficient_privilege then
    if sqlerrm <> 'Não é possível mover a tarefa para outro projeto.' then
      raise exception 'SERVICE_ROLE: mensagem inesperada: %', sqlerrm;
    end if;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- admin: move a tarefa
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  update public.tasks set project_id = '00000000-0000-0000-0000-0000000000b2'
  where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ADMIN: não moveu a tarefa'; end if;
end $$;
reset role;

do $$ begin
  if (select project_id from public.tasks where id = '00000000-0000-0000-0000-0000000000d1')
     is distinct from '00000000-0000-0000-0000-0000000000b2' then
    raise exception 'ADMIN: project_id não mudou';
  end if;
end $$;

rollback;
