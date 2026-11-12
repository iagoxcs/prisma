-- Etapa 3 do roteiro Hermes + Discord: auditoria do ai-gateway e resolução do autor do Discord.
-- ai_actions_log continua sem policy de escrita (só o service_role grava); a policy de select não muda.

alter table public.ai_actions_log
  add column source       text not null default 'discord' check (source in ('discord', 'routine')),
  add column status       text not null default 'executed'
    check (status in ('proposed', 'confirmed', 'cancelled', 'executed', 'denied', 'error')),
  add column project_id   uuid, -- sem FK: o log sobrevive à exclusão do projeto
  add column request_id   uuid,
  add column external_ref text; -- ex.: discord_user_id de uma chamada recusada (sem perfil vinculado)

create index ai_actions_log_status_idx on public.ai_actions_log (status, created_at desc);

-- Autor do Discord → perfil do Prisma. Só perfis ativos e internos; externos e inativos → null.
-- Lê auth.identities, por isso security definer; execução restrita ao service_role (ai-gateway).
create function public.profile_by_discord_id(p_discord_id text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from auth.identities i
  join public.profiles p on p.id = i.user_id
  where i.provider = 'discord'
    and i.provider_id = p_discord_id
    and p.active
    and p.role <> 'externo'
  limit 1
$$;

revoke execute on function public.profile_by_discord_id(text) from public, anon, authenticated;
grant execute on function public.profile_by_discord_id(text) to service_role;
