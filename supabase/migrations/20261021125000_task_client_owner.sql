-- Responsável no Cliente: texto livre (nome de quem, no cliente, acompanha a tarefa).
-- Coluna nova em tabela existente: RLS e policies de tasks já se aplicam.

alter table public.tasks add column client_owner text;
