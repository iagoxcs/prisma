-- GED: índice dos anexos de tarefas por projeto.
-- Views não têm RLS próprio: com security_invoker, valem as policies de task_attachments, tasks,
-- projects, clients, categories e profiles para quem consulta. Nenhuma tabela ou policy nova.
--   · consultor não-membro: 0 linhas (projects/tasks filtram por is_project_member)
--   · externo: só anexos de tarefas atribuídas ou compartilhadas (can_see_task); client_name nulo
create view public.project_documents
with (security_invoker = true)
as
select
  a.id,
  a.task_id,
  a.storage_path,
  a.file_name,
  a.size_bytes,
  a.mime_type,
  a.uploaded_by,
  a.created_at,
  t.title       as task_title,
  t.project_id,
  t.category_id,
  p.name        as project_name,
  p.client_id,
  c.name        as client_name,
  cat.name      as category_name,
  u.name        as uploader_name
from public.task_attachments a
join public.tasks t on t.id = a.task_id
join public.projects p on p.id = t.project_id
left join public.clients c on c.id = p.client_id
left join public.categories cat on cat.id = t.category_id
left join public.profiles u on u.id = a.uploaded_by;

revoke all on public.project_documents from public, anon, authenticated;
grant select on public.project_documents to authenticated;

-- Listagem do GED ordena por envio mais recente.
create index if not exists task_attachments_created_idx on public.task_attachments (created_at desc);
