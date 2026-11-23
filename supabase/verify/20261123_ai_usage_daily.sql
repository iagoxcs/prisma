-- Verificação da telemetria de uso da IA (20261123221800_ai_usage_daily.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261123_ai_usage_daily.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a1 admin · a3 consultor. A gravação é como service_role, como faz o ai-gateway.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@teste.local', '{"name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'consultor@teste.local', '{"name":"Consultor"}');

update public.profiles set active = true, role = case id
  when '00000000-0000-0000-0000-0000000000a1' then 'admin'
  else 'consultor' end::public.user_role
where id::text like '00000000-0000-0000-0000-0000000000a%';

-- ---------------------------------------------------------------------------
-- service_role: duas chamadas somam na mesma linha; fonte e contador inválidos são recusados (23514)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare r record;
begin
  perform public.record_ai_usage('2026-11-20', 'bot', 'claude-sonnet-5.5', 2, 100, 50, 1000, 10);
  perform public.record_ai_usage('2026-11-20', 'bot', 'claude-sonnet-5.5', 1, 20, 5, 300, 0);
  perform public.record_ai_usage('2026-11-20', 'rotina', 'claude-haiku-5.5', 1, 7, 3, 0, 0);

  select * into r from public.ai_usage_daily where day = '2026-11-20' and source = 'bot' and model = 'claude-sonnet-5.5';
  if r.calls <> 3 or r.input_tokens <> 120 or r.output_tokens <> 55 or r.cache_read_tokens <> 1300 or r.cache_write_tokens <> 10 then
    raise exception 'SOMA: esperava 3/120/55/1300/10, achou %/%/%/%/%',
      r.calls, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens;
  end if;
  if (select count(*) from public.ai_usage_daily where day = '2026-11-20') <> 2 then
    raise exception 'SOMA: esperava 2 linhas (bot e rotina)';
  end if;

  begin
    perform public.record_ai_usage('2026-11-20', 'outra', 'x', 1, 1, 1, 0, 0);
    raise exception 'FONTE: aceitou fonte inválida';
  exception when check_violation then null;
  end;

  begin
    perform public.record_ai_usage('2026-11-21', 'bot', 'claude-sonnet-5.5', 1, -5, 1, 0, 0);
    raise exception 'NEGATIVO: aceitou contador negativo';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- consultor: não lê a tabela nem executa a função
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.ai_usage_daily) <> 0 then
    raise exception 'CONSULTOR: leu ai_usage_daily';
  end if;
  begin
    perform public.record_ai_usage('2026-11-20', 'bot', 'claude-sonnet-5.5', 1, 1, 1, 0, 0);
    raise exception 'CONSULTOR: executou record_ai_usage';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- admin: lê, mas também não executa a função (só o service_role grava)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.ai_usage_daily where day = '2026-11-20') <> 2 then
    raise exception 'ADMIN: não leu as 2 linhas';
  end if;
  begin
    perform public.record_ai_usage('2026-11-20', 'bot', 'claude-sonnet-5.5', 1, 1, 1, 0, 0);
    raise exception 'ADMIN: executou record_ai_usage';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.ai_usage_daily (day, source, model) values ('2026-11-22', 'bot', 'x');
    raise exception 'ADMIN: inseriu direto na tabela';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
