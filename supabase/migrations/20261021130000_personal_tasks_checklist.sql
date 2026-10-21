-- Minhas Tarefas: observações e checklist por tarefa. As policies da tabela já cobrem as colunas novas.

alter table public.personal_tasks
  add column notes text check (notes is null or length(notes) <= 5000),
  add column checklist jsonb not null default '[]'::jsonb
    check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 100);
