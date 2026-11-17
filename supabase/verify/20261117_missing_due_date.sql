-- Verificação do lembrete de tarefas sem prazo (20261117204323_missing_due_date.sql).
-- SÓ NA STACK LOCAL. Rode depois de `supabase db reset`:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/verify/20261117_missing_due_date.sql
-- Tudo roda numa transação com ROLLBACK no fim: nada fica gravado. Qualquer falha aborta com a mensagem do caso.
--
-- Perfis: a2 gerente ativo de b1, b2 e b3.
-- Projetos: b1 em andamento (2 abertas sem prazo, 1 feita sem prazo, 1 aberta com prazo);
--           b2 concluído (1 aberta sem prazo); b3 pausado (só tarefa com prazo).

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a2', 'gerente@teste.local', '{"name":"Gerente"}');

update public.profiles set active = true, role = 'gerente'::public.user_role
where id = '00000000-0000-0000-0000-0000000000a2';

insert into public.projects (id, name, manager_id, status) values
  ('00000000-0000-0000-0000-0000000000b1', 'Projeto B1', '00000000-0000-0000-0000-0000000000a2', 'em_andamento'),
  ('00000000-0000-0000-0000-0000000000b2', 'Projeto B2', '00000000-0000-0000-0000-0000000000a2', 'concluido'),
  ('00000000-0000-0000-0000-0000000000b3', 'Projeto B3', '00000000-0000-0000-0000-0000000000a2', 'pausado');

insert into public.tasks (id, project_id, title, created_by, status, due_date) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'D1', '00000000-0000-0000-0000-0000000000a2', 'todo',  null),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', 'D2', '00000000-0000-0000-0000-0000000000a2', 'doing', null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b1', 'D3', '00000000-0000-0000-0000-0000000000a2', 'done',  null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000b1', 'D4', '00000000-0000-0000-0000-0000000000a2', 'todo',  '2026-12-01'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000b2', 'D5', '00000000-0000-0000-0000-0000000000a2', 'todo',  null),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000b3', 'D6', '00000000-0000-0000-0000-0000000000a2', 'todo',  '2026-12-01');

do $$
declare
  n integer;
  msg text;
begin
  -- Caso 1: só b1 gera notificação; tarefa feita, projeto concluído e projeto sem pendência não contam.
  delete from public.notifications where type = 'missing_due_date';
  n := public.generate_missing_due_date_notifications();
  if n <> 1 then raise exception 'GERAÇÃO: esperava 1 notificação, veio %', n; end if;

  select count(*) into n from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000a2' and type = 'missing_due_date';
  if n <> 1 then raise exception 'GERAÇÃO: gerente com % notificações (esperava 1)', n; end if;

  select message into msg from public.notifications
  where user_id = '00000000-0000-0000-0000-0000000000a2' and type = 'missing_due_date'
    and entity_type = 'project' and entity_id = '00000000-0000-0000-0000-0000000000b1'
    and project_id = '00000000-0000-0000-0000-0000000000b1';
  if msg is distinct from '2 tarefa(s) sem prazo em Projeto B1' then
    raise exception 'GERAÇÃO: mensagem inesperada: %', msg;
  end if;

  -- Caso 2: parâmetro desligado não gera nada.
  delete from public.notifications where type = 'missing_due_date';
  update public.app_settings set value = 'false' where key = 'notify_missing_due_date';
  n := public.generate_missing_due_date_notifications();
  if n <> 0 then raise exception 'PARÂMETRO: desligado e gerou %', n; end if;
  if exists (select 1 from public.notifications where type = 'missing_due_date') then
    raise exception 'PARÂMETRO: desligado e há notificação';
  end if;

  -- Caso 3: job agendado nos dias 1 e 15.
  if not exists (select 1 from cron.job where jobname = 'prisma-missing-due-date' and schedule = '0 11 1,15 * *') then
    raise exception 'CRON: job prisma-missing-due-date ausente ou com horário diferente';
  end if;
end $$;

rollback;
