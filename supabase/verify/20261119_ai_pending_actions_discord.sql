-- Verificação das colunas do Discord em ai_pending_actions (20261119174328_ai_pending_actions_discord.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261119_ai_pending_actions_discord.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfil: a3 consultor, dono da ação pendente e1.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a3', 'consultor@teste.local', '{"name":"Consultor"}');

update public.profiles set active = true, role = 'consultor'::public.user_role
where id = '00000000-0000-0000-0000-0000000000a3';

-- ---------------------------------------------------------------------------
-- gravação pelo gateway (aqui, postgres): ids válidos passam; id inválido é recusado
-- ---------------------------------------------------------------------------
insert into public.ai_pending_actions
  (id, user_id, tool, input, code_hash, expires_at, discord_user_id, discord_channel_id, discord_message_id)
values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'create_task', '{}', 'h',
   now() + interval '10 minutes', '1570233296648937472', '1570163994159751409', '1570163994159751410');

do $$ begin
  begin
    update public.ai_pending_actions set discord_message_id = 'abc'
    where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'CHECK: aceitou discord_message_id inválido';
  exception when check_violation then null;
  end;
  begin
    update public.ai_pending_actions set discord_user_id = '12'
    where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception 'CHECK: aceitou discord_user_id inválido';
  exception when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- dono (authenticated): lê a própria linha, mas não altera (sem policy de update)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.ai_pending_actions where id = '00000000-0000-0000-0000-0000000000e1';
  if n <> 1 then raise exception 'DONO: não vê a própria ação pendente'; end if;

  -- Sem policy de update: 0 linhas; sem grant de update: 42501. Os dois bloqueiam.
  begin
    update public.ai_pending_actions set discord_message_id = '1570163994159751411'
    where id = '00000000-0000-0000-0000-0000000000e1';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'DONO: alterou ai_pending_actions sem policy de update'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  if (select discord_message_id from public.ai_pending_actions where id = '00000000-0000-0000-0000-0000000000e1')
     is distinct from '1570163994159751410' then
    raise exception 'DONO: discord_message_id mudou';
  end if;
end $$;

rollback;
