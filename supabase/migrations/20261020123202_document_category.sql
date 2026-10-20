-- GED: categoria do documento (lista fixa). Nulo = sem categoria.
-- Quem pode categorizar: quem enviou o arquivo ou o gerente do projeto (admin via is_project_manager),
-- a mesma regra da exclusão. O UPDATE só alcança a coluna doc_category.

alter table public.task_attachments
  add column doc_category text check (
    doc_category in ('politica', 'pop', 'ata', 'relatorio', 'proposta_contrato', 'planilha', 'evidencia', 'apresentacao', 'outros')
  );
create index task_attachments_doc_category_idx on public.task_attachments (doc_category);

revoke update on public.task_attachments from authenticated;
grant update (doc_category) on public.task_attachments to authenticated;

create policy attachments_update on public.task_attachments for update to authenticated
  using (uploaded_by = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id)))
  with check (uploaded_by = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id)));

-- A view expõe a nova coluna; mesmas regras de 20261020110726 (security_invoker, só leitura).
drop view public.project_documents;
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
  a.doc_category,
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
