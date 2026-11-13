-- Etapa 5 do roteiro Hermes + Discord: ações de escrita da IA em duas fases (propor → confirmar com código).
-- Só o ai-gateway (service_role) grava; o usuário lê as próprias ações. O código nunca é guardado em claro.

create table public.ai_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  tool         text not null,
  input        jsonb not null,
  code_hash    text not null,
  attempts     integer not null default 0,
  status       text not null default 'proposed' check (status in ('proposed', 'committed', 'cancelled', 'expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  committed_at timestamptz
);
alter table public.ai_pending_actions enable row level security;
create index ai_pending_actions_user_status_idx on public.ai_pending_actions (user_id, status, expires_at);

-- Sem policies de insert/update/delete: escrita só pelo service_role.
create policy ai_pending_actions_select on public.ai_pending_actions for select to authenticated
  using (user_id = (select auth.uid()));
