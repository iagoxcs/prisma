-- O5, fatia a: telemetria de custo da IA por contagem de tokens (decisão DP3, 23/11/2026).
-- O router da Hostinger não tem API de uso; o plugin do Hermes (bot e transcrição) e a rotina diária contam os
-- tokens de cada chamada e o ai-gateway soma aqui, por dia (America/Sao_Paulo), fonte e modelo. O custo é
-- calculado na hora do relatório (tokens × tabela de preços da rotina); a tabela guarda só tokens.

create table public.ai_usage_daily (
  day                date        not null,
  source             text        not null check (source in ('bot', 'transcricao', 'rotina')),
  model              text        not null check (char_length(model) between 1 and 100),
  calls              integer     not null default 0 check (calls >= 0),
  input_tokens       bigint      not null default 0 check (input_tokens >= 0),
  output_tokens      bigint      not null default 0 check (output_tokens >= 0),
  cache_read_tokens  bigint      not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens bigint      not null default 0 check (cache_write_tokens >= 0),
  updated_at         timestamptz not null default now(),
  primary key (day, source, model)
);

-- Leitura só do admin. Sem policies de escrita: só o service_role (ai-gateway) grava, pela função abaixo.
alter table public.ai_usage_daily enable row level security;
create policy ai_usage_daily_select on public.ai_usage_daily for select to authenticated
  using (public.is_admin());

-- Soma atômica dos contadores (várias chamadas no mesmo dia, fonte e modelo viram uma linha).
create function public.record_ai_usage(
  p_day date, p_source text, p_model text, p_calls integer,
  p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.ai_usage_daily as u
    (day, source, model, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
  values (p_day, p_source, p_model, p_calls, p_input, p_output, p_cache_read, p_cache_write)
  on conflict (day, source, model) do update set
    calls              = u.calls + excluded.calls,
    input_tokens       = u.input_tokens + excluded.input_tokens,
    output_tokens      = u.output_tokens + excluded.output_tokens,
    cache_read_tokens  = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    updated_at         = now();
$$;

revoke execute on function public.record_ai_usage(date, text, text, integer, bigint, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.record_ai_usage(date, text, text, integer, bigint, bigint, bigint, bigint)
  to service_role;
