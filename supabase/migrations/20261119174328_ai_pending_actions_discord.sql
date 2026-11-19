-- O3: prévias da IA resistentes a reinício. Guarda onde a prévia foi postada no Discord, para o plugin
-- retomar a observação depois que o container reinicia. Escrita continua só pelo ai-gateway (service_role):
-- nenhuma policy nova; a policy de select (o usuário lê as próprias ações) não muda.

alter table public.ai_pending_actions
  add column discord_user_id    text check (discord_user_id ~ '^[0-9]{5,25}$'),
  add column discord_channel_id text check (discord_channel_id ~ '^[0-9]{17,20}$'),
  add column discord_message_id text check (discord_message_id ~ '^[0-9]{17,20}$');

-- Consulta da retomada: prévias abertas que já têm mensagem no Discord.
create index ai_pending_actions_open_idx on public.ai_pending_actions (expires_at)
  where status = 'proposed' and discord_message_id is not null;
