-- INSERT ... RETURNING avalia a policy de SELECT na linha nova; as funções helper consultam a
-- tabela com outro snapshot e não enxergam a linha recém-inserida. Cláusulas inline resolvem.
drop policy projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
  using (
    public.is_project_member(id)
    or (manager_id = (select auth.uid()) and public.current_user_role() is not null)
  );

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    public.can_see_task(id)
    or (created_by = (select auth.uid()) and public.can_create_in_project(project_id))
  );
