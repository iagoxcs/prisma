-- Etapa 4 do roteiro Hermes + Discord: um canal do Discord por projeto e o resumo diário no contexto.
-- Policies de projects e project_context_entries inalteradas: a rotina grava pelo service_role (ai-gateway).

-- Canal do projeto no Discord (ID numérico, um canal por projeto). Editado por quem já edita o projeto.
alter table public.projects
  add column discord_channel_id text unique,
  add constraint projects_discord_channel_id_check check (discord_channel_id ~ '^[0-9]{17,20}$');

-- Novo tipo de contexto: resumo diário das conversas do canal.
alter table public.project_context_entries
  drop constraint project_context_entries_kind_check,
  add constraint project_context_entries_kind_check check (kind in ('transcricao', 'ata', 'anotacao', 'discord'));

-- Origem externa da entrada (rotina: '<channel_id>:<AAAA-MM-DD>'). Único para a reexecução não duplicar.
alter table public.project_context_entries
  add column source_ref text unique;
