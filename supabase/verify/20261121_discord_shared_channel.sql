-- Verificação do canal do Discord compartilhado entre projetos (20261121174007_discord_shared_channel.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261121_discord_shared_channel.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Projetos b1 e b2 no mesmo canal. As entradas de contexto entram como service_role, como faz o ai-gateway.

begin;

-- ---------------------------------------------------------------------------
-- estrutura: unique antigos fora, índice e unique por projeto presentes, check de formato mantido
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'projects_discord_channel_id_key') then
    raise exception 'ESTRUTURA: projects_discord_channel_id_key ainda existe';
  end if;
  if exists (select 1 from pg_constraint where conname = 'project_context_entries_source_ref_key') then
    raise exception 'ESTRUTURA: project_context_entries_source_ref_key ainda existe';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_context_entries_project_source_ref_key') then
    raise exception 'ESTRUTURA: falta project_context_entries_project_source_ref_key';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_discord_channel_id_check') then
    raise exception 'ESTRUTURA: falta projects_discord_channel_id_check';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'projects_discord_channel_id_idx') then
    raise exception 'ESTRUTURA: falta projects_discord_channel_id_idx';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- dois projetos aceitam o mesmo canal
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  insert into public.projects (id, name, discord_channel_id) values
    ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '157079655081535492'),
    ('00000000-0000-0000-0000-0000000000b2', 'Projeto B2', '157079655081535492');
  select count(*) into n from public.projects where discord_channel_id = '157079655081535492';
  if n <> 2 then raise exception 'CANAL: esperava 2 projetos no canal, achou %', n; end if;
exception when unique_violation then
  raise exception 'CANAL: o mesmo canal foi recusado no segundo projeto';
end $$;

-- ---------------------------------------------------------------------------
-- canal fora do formato continua recusado (23514)
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    update public.projects set discord_channel_id = 'canal-123'
    where id = '00000000-0000-0000-0000-0000000000b1';
    raise exception 'FORMATO: aceitou canal fora do formato';
  exception when check_violation then
    null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- service_role: o mesmo source_ref entra em dois projetos; repetido no mesmo projeto dá 23505
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare n int;
begin
  insert into public.project_context_entries (project_id, kind, title, body, meeting_date, source_ref) values
    ('00000000-0000-0000-0000-0000000000b1', 'discord', 'Discord 20/11/2026', 'Resumo do canal.', '2026-11-20', '157079655081535492:2026-11-20'),
    ('00000000-0000-0000-0000-0000000000b2', 'discord', 'Discord 20/11/2026', 'Resumo do canal.', '2026-11-20', '157079655081535492:2026-11-20');
  select count(*) into n from public.project_context_entries where source_ref = '157079655081535492:2026-11-20';
  if n <> 2 then raise exception 'SOURCE_REF: esperava 2 entradas, achou %', n; end if;

  begin
    insert into public.project_context_entries (project_id, kind, title, body, meeting_date, source_ref) values
      ('00000000-0000-0000-0000-0000000000b1', 'discord', 'Discord 20/11/2026', 'Repetido.', '2026-11-20', '157079655081535492:2026-11-20');
    raise exception 'SOURCE_REF: aceitou o mesmo source_ref duas vezes no mesmo projeto';
  exception when unique_violation then
    null;
  end;
end $$;
reset role;

rollback;
