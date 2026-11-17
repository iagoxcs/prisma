-- O job prisma-deadline-emails passa a ler a base das Edge Functions do Vault
-- (segredo prisma_functions_url, criado à mão por ambiente; ver docs/DEPLOY.md, item 1.3).
-- Sem o segredo, o select não retorna linha: nenhuma chamada é feita e o job não falha.
select cron.unschedule('prisma-deadline-emails');

-- 08:05 em Brasília (11:05 UTC), logo depois de prisma-deadline-notifications.
select cron.schedule('prisma-deadline-emails', '5 11 * * *', $$
  select net.http_post(
    url := s.decrypted_secret || '/deadline-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'prisma_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
  from vault.decrypted_secrets s
  where s.name = 'prisma_functions_url'
$$);
