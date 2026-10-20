-- Verificação de RLS: project_documents, knowledge_base e project_context.
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261020_rls_documents_knowledge_context.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.

begin;

-- ---------------------------------------------------------------------------
-- Massa de teste (como postgres, sem RLS)
-- ---------------------------------------------------------------------------
-- a = admin, g = gerente do projeto, c = consultor membro, n = consultor não-membro, e = externo membro
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

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Cliente Teste');
insert into public.projects (id, client_id, name, manager_id)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'Projeto Teste', '00000000-0000-0000-0000-0000000000a2');
insert into public.project_members (project_id, user_id, project_role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', 'consultor'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a5', 'externo');

-- t1: atribuída ao externo · t2: compartilhada com o externo · t3: interna
insert into public.tasks (id, project_id, title, assignee_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Atribuída', '00000000-0000-0000-0000-0000000000a5'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'Compartilhada', null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 'Interna', null);
insert into public.task_shares (task_id, user_id)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a5');

insert into public.task_attachments (task_id, storage_path, file_name, size_bytes, uploaded_by) values
  ('00000000-0000-0000-0000-0000000000d1', 'b1/d1/a.pdf', 'a.pdf', 10, '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000d2', 'b1/d2/b.pdf', 'b.pdf', 10, '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000d3', 'b1/d3/c.pdf', 'c.pdf', 10, '00000000-0000-0000-0000-0000000000a3');

-- ---------------------------------------------------------------------------
-- 1) project_documents
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_documents) <> 0 then raise exception 'DOC: consultor não-membro deveria ver 0 linhas'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_documents) <> 2 then raise exception 'DOC: externo deveria ver 2 anexos (atribuída + compartilhada)'; end if;
  if exists (select 1 from public.project_documents where task_id = '00000000-0000-0000-0000-0000000000d3') then raise exception 'DOC: externo viu anexo de tarefa interna'; end if;
  if exists (select 1 from public.project_documents where client_name is not null) then raise exception 'DOC: externo não deveria ver o nome do cliente'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_documents) <> 3 then raise exception 'DOC: consultor membro deveria ver 3 anexos'; end if;
  if (select count(*) from public.project_documents where client_name = 'Cliente Teste' and uploader_name = 'Consultor') <> 3 then raise exception 'DOC: nomes de cliente/autor ausentes para interno'; end if;
end $$;
reset role;

set local role anon;
do $$ begin
  perform 1 from public.project_documents;
  raise exception 'DOC: anon não deveria ter acesso à view';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 2) knowledge_base
-- ---------------------------------------------------------------------------
-- Gerente cria rascunho
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
insert into public.knowledge_items (id, title, kind, body)
values ('00000000-0000-0000-0000-0000000000e1', 'Mapeamento de processos', 'metodologia', 'Versão inicial');
reset role;

-- Consultor não vê rascunho; não cria
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.knowledge_items) <> 0 then raise exception 'KB: consultor viu rascunho'; end if;
  begin
    insert into public.knowledge_items (title, kind) values ('Indevido', 'modelo');
    raise exception 'KB: consultor conseguiu criar item';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Gerente edita (version sobe) e publica (version não sobe)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
update public.knowledge_items set body = 'Versão revisada' where id = '00000000-0000-0000-0000-0000000000e1';
update public.knowledge_items set status = 'publicado' where id = '00000000-0000-0000-0000-0000000000e1';
do $$ begin
  if (select version from public.knowledge_items where id = '00000000-0000-0000-0000-0000000000e1') <> 2 then raise exception 'KB: version deveria ser 2'; end if;
  if (select status from public.knowledge_items where id = '00000000-0000-0000-0000-0000000000e1') <> 'publicado' then raise exception 'KB: gerente não publicou'; end if;
end $$;
insert into public.knowledge_files (item_id, storage_path, file_name, size_bytes)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1/x-modelo.docx', 'modelo.docx', 10);
reset role;

-- Consultor vê o publicado e o arquivo
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.knowledge_items) <> 1 then raise exception 'KB: consultor deveria ver o publicado'; end if;
  if (select count(*) from public.knowledge_files) <> 1 then raise exception 'KB: consultor deveria ver o arquivo do publicado'; end if;
  if (select count(*) from public.knowledge_items where search @@ websearch_to_tsquery('portuguese', 'processo')) <> 1 then raise exception 'KB: busca textual não encontrou o item'; end if;
end $$;
reset role;

-- Externo: 0 linhas
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.knowledge_items) <> 0 then raise exception 'KB: externo deveria ver 0 itens'; end if;
  if (select count(*) from public.knowledge_files) <> 0 then raise exception 'KB: externo deveria ver 0 arquivos'; end if;
end $$;
reset role;

-- Modelos: vinculados a uma metodologia, publicação exige planilha, tipo fixo
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    insert into public.knowledge_items (title, kind) values ('Modelo solto', 'modelo');
    raise exception 'KB: modelo sem metodologia foi aceito';
  exception when check_violation then null;
  end;
  insert into public.knowledge_items (id, title, kind, methodology_id)
  values ('00000000-0000-0000-0000-0000000000e2', 'Modelo padrão', 'modelo', '00000000-0000-0000-0000-0000000000e1');
  begin
    insert into public.knowledge_items (title, kind, methodology_id) values ('Modelo de modelo', 'modelo', '00000000-0000-0000-0000-0000000000e2');
    raise exception 'KB: modelo vinculado a outro modelo foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.knowledge_items set status = 'publicado' where id = '00000000-0000-0000-0000-0000000000e2';
    raise exception 'KB: modelo sem planilha foi publicado';
  exception when check_violation then null;
  end;
  update public.knowledge_items
     set template_csv = E'Título;Escopo\r\nLevantar processos;Diagnóstico\r\n', template_file_name = 'fases.csv', status = 'publicado'
   where id = '00000000-0000-0000-0000-0000000000e2';
  begin
    update public.knowledge_items set kind = 'metodologia' where id = '00000000-0000-0000-0000-0000000000e2';
    raise exception 'KB: tipo do item foi alterado';
  exception when check_violation then null;
  end;
  begin
    delete from public.knowledge_items where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'KB: metodologia com modelos foi excluída';
  exception when foreign_key_violation then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.knowledge_items where kind = 'modelo' and methodology_id = '00000000-0000-0000-0000-0000000000e1') <> 1 then
    raise exception 'KB: consultor deveria ver o modelo publicado da metodologia';
  end if;
end $$;
reset role;

do $$ begin
  if public.knowledge_item_id('00000000-0000-0000-0000-0000000000e1/x-a.pdf') <> '00000000-0000-0000-0000-0000000000e1' then raise exception 'KB: knowledge_item_id'; end if;
  if public.knowledge_item_id('lixo/a.pdf') is not null then raise exception 'KB: knowledge_item_id deveria devolver null'; end if;
  if not exists (select 1 from storage.buckets where id = 'knowledge-files' and not public and file_size_limit = 20971520) then raise exception 'KB: bucket'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) project_context_entries
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
insert into public.project_context_entries (project_id, kind, title, body, created_by)
values ('00000000-0000-0000-0000-0000000000b1', 'ata', 'Kickoff', 'Pauta e decisões', '00000000-0000-0000-0000-0000000000a3');
do $$ begin
  if (select count(*) from public.project_context_entries) <> 1 then raise exception 'CTX: autor deveria ver o registro'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_context_entries) <> 0 then raise exception 'CTX: externo membro deveria ver 0 linhas'; end if;
  begin
    insert into public.project_context_entries (project_id, kind, title, body, created_by)
    values ('00000000-0000-0000-0000-0000000000b1', 'anotacao', 'Indevido', 'x', '00000000-0000-0000-0000-0000000000a5');
    raise exception 'CTX: externo conseguiu inserir';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_context_entries) <> 0 then raise exception 'CTX: consultor não-membro deveria ver 0 linhas'; end if;
end $$;
reset role;

-- Gerente do projeto e admin veem e editam
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
update public.project_context_entries set title = 'Kickoff (revisado)' where project_id = '00000000-0000-0000-0000-0000000000b1';
do $$ begin
  if (select title from public.project_context_entries limit 1) <> 'Kickoff (revisado)' then raise exception 'CTX: gerente do projeto não editou'; end if;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.project_context_entries) <> 1 then raise exception 'CTX: admin deveria ver o registro'; end if;
end $$;
reset role;

select 'OK: todas as verificações passaram' as resultado;
rollback;
