-- Verificação do tipo "organizacional" na Base de Conhecimento (P14).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261125_knowledge_organizacional.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado.

begin;

-- g = gerente, c = consultor
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000001a2', 'gerente-org@teste.local', '{"name":"Gerente"}'),
  ('00000000-0000-0000-0000-0000000001a3', 'consultor-org@teste.local', '{"name":"Consultor"}');
update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000001a2' then 'gerente'
  else 'consultor' end::public.user_role
where id in ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000001a3');

-- Gerente cria um organizacional (rascunho), tenta publicar sem corpo, depois publica com corpo.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a2","role":"authenticated"}', true);
set local role authenticated;
insert into public.knowledge_items (id, title, kind)
values ('00000000-0000-0000-0000-0000000001e1', 'Política de férias', 'organizacional');
insert into public.knowledge_items (id, title, kind, body)
values ('00000000-0000-0000-0000-0000000001e2', 'Rascunho interno', 'organizacional', 'Ainda em revisão');
do $$
begin
  begin
    update public.knowledge_items set status = 'publicado' where id = '00000000-0000-0000-0000-0000000001e1';
    raise exception 'ORG: publicou sem corpo';
  exception when check_violation then null;
  end;
  begin
    insert into public.knowledge_items (title, kind, methodology_id)
    select 'Vinculado', 'organizacional', id from public.knowledge_items where id = '00000000-0000-0000-0000-0000000001e2';
    raise exception 'ORG: aceitou metodologia de origem';
  exception when check_violation then null;
  end;
  begin
    insert into public.knowledge_items (title, kind, template_csv) values ('Com planilha', 'organizacional', 'Escopo');
    raise exception 'ORG: aceitou planilha de fases';
  exception when check_violation then null;
  end;
  begin
    insert into public.knowledge_items (title, kind) values ('Tipo inválido', 'outro');
    raise exception 'ORG: aceitou tipo desconhecido';
  exception when check_violation then null;
  end;
end $$;
update public.knowledge_items set body = 'Regras de férias da equipe', status = 'publicado'
where id = '00000000-0000-0000-0000-0000000001e1';
reset role;

-- Consultor vê o publicado (e acha na busca), não vê o rascunho, não cria.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a3","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.knowledge_items where id = '00000000-0000-0000-0000-0000000001e1') then
    raise exception 'ORG: consultor não vê o publicado';
  end if;
  if exists (select 1 from public.knowledge_items where id = '00000000-0000-0000-0000-0000000001e2') then
    raise exception 'ORG: consultor viu rascunho';
  end if;
  if not exists (select 1 from public.knowledge_items where kind = 'organizacional' and search @@ websearch_to_tsquery('portuguese', 'férias')) then
    raise exception 'ORG: busca textual não encontrou o item';
  end if;
  begin
    insert into public.knowledge_items (title, kind) values ('Indevido', 'organizacional');
    raise exception 'ORG: consultor conseguiu criar item';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
