-- Endurecimento pós-advisors do Supabase.
-- 1) anon não executa funções; trigger functions não são chamáveis via RPC.
--    (authenticated mantém EXECUTE nos helpers: as policies de RLS os chamam como o usuário.)
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.notify_task_assigned() from authenticated;
revoke execute on function public.notify_comment() from authenticated;
revoke execute on function public.log_activity() from authenticated;
revoke execute on function public.tasks_set_concluded_at() from authenticated;
revoke execute on function public.reports_set_version() from authenticated;
revoke execute on function public.set_updated_at() from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;

-- 2) auth.uid() em subselect (initplan) e policies sem sobreposição de SELECT.
drop policy profiles_select on public.profiles;
drop policy profiles_update_self on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_internal() or public.shares_project_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy projects_insert on public.projects;
drop policy projects_update on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_admin() or (public.has_role('gerente') and manager_id = (select auth.uid())));
create policy projects_update on public.projects for update to authenticated
  using (public.is_project_manager(id))
  with check (public.is_admin() or manager_id = (select auth.uid()));

drop policy categories_write on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)));
create policy categories_update on public.categories for update to authenticated
  using (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)))
  with check (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)));
create policy categories_delete on public.categories for delete to authenticated
  using (public.is_project_manager(project_id) or (public.has_role('lider') and public.is_project_member(project_id)));

drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.can_create_in_project(project_id) and created_by = (select auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using (public.can_edit_task(id))
  with check (
    public.is_project_manager(project_id)
    or (public.has_role('lider') and public.is_project_member(project_id))
    or assignee_id = (select auth.uid()));

drop policy task_shares_select on public.task_shares;
drop policy task_shares_write on public.task_shares;
create policy task_shares_select on public.task_shares for select to authenticated
  using (user_id = (select auth.uid()) or public.can_edit_task(task_id));
create policy task_shares_insert on public.task_shares for insert to authenticated
  with check (public.can_edit_task(task_id) and public.is_internal());
create policy task_shares_update on public.task_shares for update to authenticated
  using (public.can_edit_task(task_id) and public.is_internal())
  with check (public.can_edit_task(task_id) and public.is_internal());
create policy task_shares_delete on public.task_shares for delete to authenticated
  using (public.can_edit_task(task_id) and public.is_internal());

drop policy checklist_write on public.checklist_items;
create policy checklist_insert on public.checklist_items for insert to authenticated
  with check (public.can_edit_task(task_id));
create policy checklist_update on public.checklist_items for update to authenticated
  using (public.can_edit_task(task_id)) with check (public.can_edit_task(task_id));
create policy checklist_delete on public.checklist_items for delete to authenticated
  using (public.can_edit_task(task_id));

drop policy attachments_insert on public.task_attachments;
drop policy attachments_delete on public.task_attachments;
create policy attachments_insert on public.task_attachments for insert to authenticated
  with check (public.can_see_task(task_id) and uploaded_by = (select auth.uid()));
create policy attachments_delete on public.task_attachments for delete to authenticated
  using (uploaded_by = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id)));

drop policy comments_insert on public.comments;
drop policy comments_update on public.comments;
drop policy comments_delete on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (public.can_see_task(task_id) and author_id = (select auth.uid()) and (not is_internal or public.is_internal()));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and (not is_internal or public.is_internal()));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_id and public.is_project_manager(t.project_id)));

drop policy notifications_select on public.notifications;
drop policy notifications_update on public.notifications;
drop policy notifications_delete on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

drop policy reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (generated_by = (select auth.uid()) and (
    (project_id is not null and public.can_create_in_project(project_id))
    or (project_id is null and public.is_admin())));

drop policy ai_actions_log_select on public.ai_actions_log;
create policy ai_actions_log_select on public.ai_actions_log for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- 3) índices de FK
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_category_idx on public.tasks (category_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists categories_project_idx on public.categories (project_id);
create index if not exists reports_project_idx on public.reports (project_id);
create index if not exists reports_generated_by_idx on public.reports (generated_by);
create index if not exists comments_author_idx on public.comments (author_id);
create index if not exists task_attachments_uploader_idx on public.task_attachments (uploaded_by);
