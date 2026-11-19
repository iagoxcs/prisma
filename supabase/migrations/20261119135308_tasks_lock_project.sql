-- A6: tarefa não muda de projeto, exceto por admin.
-- A policy tasks_update só avalia o projeto de destino; este trigger fecha a troca de project_id.
-- Vale para qualquer papel, inclusive service_role (sem auth.uid(), is_admin() é falso).

create function public.tasks_lock_project()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id and not public.is_admin() then
    raise exception 'Não é possível mover a tarefa para outro projeto.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_lock_project() from public, anon, authenticated;

create trigger tasks_lock_project
  before update of project_id on public.tasks
  for each row execute function public.tasks_lock_project();
