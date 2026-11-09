-- Verificação de role_permissions / role_can (20261109120000_role_permissions.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261109_rls_role_permissions.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a2 gerente (gestor de b1) · a3 consultor membro de b1 · a5 externo membro de b1.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'gerente@teste.local', '{"name":"Gerente"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'consultor@teste.local', '{"name":"Consultor"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'externo@teste.local', '{"name":"Externo"}');

update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000000a1' then 'admin'
  when '00000000-0000-0000-0000-0000000000a2' then 'gerente'
  when '00000000-0000-0000-0000-0000000000a3' then 'consultor'
  else 'externo' end::public.user_role
where id::text like '00000000-0000-0000-0000-0000000000a%';

insert into public.projects (id, name, manager_id) values
  ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '00000000-0000-0000-0000-0000000000a2');
insert into public.project_members (project_id, user_id, project_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'consultor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a5', 'externo');
insert into public.tasks (id, project_id, title, created_by) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Tarefa D1', '00000000-0000-0000-0000-0000000000a2');

-- ---------------------------------------------------------------------------
-- seed: 40 linhas (5 perfis × 8 capacidades), igual ao comportamento anterior
-- ---------------------------------------------------------------------------
do $$ begin
  if (select count(*) from public.role_permissions) <> 40 then raise exception 'SEED: esperava 40 linhas'; end if;
  if exists (select 1 from public.role_permissions where role = 'externo' and allowed) then raise exception 'SEED: externo com permissão'; end if;
  if exists (select 1 from public.role_permissions where role = 'admin' and not allowed) then raise exception 'SEED: admin sem permissão'; end if;
  if not (select allowed from public.role_permissions where role = 'consultor' and permission = 'task.create') then
    raise exception 'SEED: consultor deveria criar tarefas';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- consultor: não altera permissões; cria tarefa com o padrão; não exclui
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  update public.role_permissions set allowed = true where role = 'consultor' and permission = 'task.delete';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CONSULTOR: alterou role_permissions'; end if;

  insert into public.tasks (project_id, title, created_by)
  values ('00000000-0000-0000-0000-0000000000b1', 'Criada pelo consultor', '00000000-0000-0000-0000-0000000000a3');

  delete from public.tasks where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'CONSULTOR: excluiu tarefa sem task.delete'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- admin: não altera linhas fixas (admin/externo); desliga task.create do consultor
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    update public.role_permissions set allowed = false where role = 'admin' and permission = 'task.delete';
    raise exception 'ADMIN: alterou a linha fixa do admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.role_permissions set allowed = true where role = 'externo' and permission = 'clients.view';
    raise exception 'ADMIN: deu permissão a externo';
  exception when insufficient_privilege then null;
  end;
  update public.role_permissions set allowed = false where role = 'consultor' and permission = 'task.create';
  update public.role_permissions set allowed = true where role = 'consultor' and permission = 'task.delete';
end $$;
reset role;

do $$ begin
  if not exists (select 1 from public.activity_log where entity = 'role_permissions') then
    raise exception 'AUDITORIA: alteração não registrada';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- consultor após a mudança: não cria; agora exclui
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  begin
    insert into public.tasks (project_id, title, created_by)
    values ('00000000-0000-0000-0000-0000000000b1', 'Não deveria entrar', '00000000-0000-0000-0000-0000000000a3');
    raise exception 'CONSULTOR: criou tarefa sem task.create';
  exception when insufficient_privilege then null;
  end;

  delete from public.tasks where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONSULTOR: não excluiu com task.delete'; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- externo: nunca vê clientes
-- ---------------------------------------------------------------------------
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Cliente C1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.clients) then raise exception 'EXTERNO: viu clientes'; end if;
end $$;
reset role;

rollback;
