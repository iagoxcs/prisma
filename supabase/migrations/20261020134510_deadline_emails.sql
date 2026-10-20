-- Alertas de prazo também por e-mail (Resend). O pg_cron gera as notificações às 08:00 (BRT);
-- às 08:05 chama a Edge Function deadline-emails, que manda um resumo por pessoa e marca emailed_at.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- notifications.emailed_at: preenchido só pela Edge Function (service_role).
-- O usuário continua podendo alterar apenas `read` (grant de coluna existente).
-- ---------------------------------------------------------------------------
alter table public.notifications add column emailed_at timestamptz;

-- Histórico não vira e-mail no primeiro envio.
update public.notifications set emailed_at = created_at
 where type in ('due_soon', 'overdue') and emailed_at is null;

create index notifications_email_pending_idx on public.notifications (created_at)
  where emailed_at is null and type in ('due_soon', 'overdue');

-- ---------------------------------------------------------------------------
-- Parâmetro: liga/desliga o envio por e-mail.
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description) values
  ('email_deadline_alerts', 'true', 'Enviar também por e-mail os alertas de prazo');

create or replace function public.app_settings_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v jsonb := new.value;
  item jsonb;
begin
  case new.key
    when 'organization_name' then
      if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 80 then
        raise exception 'organization_name: texto de 1 a 80 caracteres';
      end if;
    when 'deadline_warning_days' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
         or (v #>> '{}')::numeric not between 0 and 14 then
        raise exception 'deadline_warning_days: inteiro de 0 a 14';
      end if;
    when 'notify_due_soon', 'notify_overdue', 'email_deadline_alerts' then
      if jsonb_typeof(v) <> 'boolean' then
        raise exception '%: verdadeiro ou falso', new.key;
      end if;
    when 'default_categories' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then
        raise exception 'default_categories: lista de até 20 nomes';
      end if;
      for item in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(item) <> 'string' or length(trim(item #>> '{}')) not between 1 and 40 then
          raise exception 'default_categories: cada nome deve ter de 1 a 40 caracteres';
        end if;
      end loop;
    else
      raise exception 'parâmetro desconhecido: %', new.key;
  end case;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.app_settings_before_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Segredo compartilhado entre o cron e a Edge Function, gerado aqui (sem passo manual).
-- A função (verify_jwt = false) confere o cabeçalho x-cron-secret por esta RPC.
-- ---------------------------------------------------------------------------
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'prisma_cron_secret',
                           'Autentica o pg_cron na Edge Function deadline-emails');

create function public.check_cron_secret(secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets
    where name = 'prisma_cron_secret' and decrypted_secret = secret);
$$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

-- 08:05 em Brasília (11:05 UTC), logo depois de prisma-deadline-notifications.
-- Projeto único (produção): URL fixa, ver docs/DEPLOY.md.
select cron.schedule('prisma-deadline-emails', '5 11 * * *', $$
  select net.http_post(
    url := 'https://jipaumhvkldxnmwfdmji.supabase.co/functions/v1/deadline-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'prisma_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
