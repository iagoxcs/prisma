-- Tarefa cancelada (P2): novo valor do enum, sozinho nesta migração porque um valor novo de enum
-- só pode ser usado depois que a transação que o criou termina. O uso vem em 20261119230100.
alter type public.task_status add value if not exists 'cancelled';
