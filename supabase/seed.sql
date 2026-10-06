-- Dados de desenvolvimento (rodado por `supabase db reset`). NÃO usar em produção.
-- Usuários são criados via Auth; depois promova-os com:
--   select public.admin_update_profile('<uuid>', 'admin', true);
-- (para o primeiro admin, rode como `postgres` no SQL Editor:
--   update public.profiles set role = 'admin', active = true where id = '<uuid>';)

insert into public.clients (name) values ('Cliente Exemplo')
on conflict do nothing;
