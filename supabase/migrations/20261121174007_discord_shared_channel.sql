-- I1, fatia a: mais de um projeto no mesmo canal do Discord (decisão DP1, 21/11/2026).
-- Nenhuma tabela nova; RLS e policies de projects e project_context_entries inalteradas.
-- A rotina grava pelo ai-gateway, que desde a fatia b (PR 80) busca a entrada por project_id + source_ref
-- e faz update/insert, sem depender do unique global de source_ref.

-- Canal compartilhado: sai o unique de discord_channel_id; o check de formato continua.
-- O índice parcial mantém rápida a busca dos projetos de um canal (rotina e editor do projeto).
alter table public.projects
  drop constraint projects_discord_channel_id_key;

create index projects_discord_channel_id_idx
  on public.projects (discord_channel_id)
  where discord_channel_id is not null;

-- O mesmo resumo do canal ('<channel_id>:<AAAA-MM-DD>') entra uma vez em cada projeto vinculado.
alter table public.project_context_entries
  drop constraint project_context_entries_source_ref_key,
  add constraint project_context_entries_project_source_ref_key unique (project_id, source_ref);
