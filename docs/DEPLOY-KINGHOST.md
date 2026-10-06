# Deploy na KingHost (site estático)

O build gera a pasta `out/` (HTML/JS/CSS). Basta publicá-la na raiz do site; não há processo Node no servidor.

## 1. Supabase
1. O projeto Supabase já está aplicado via MCP. Para trabalhar pela CLI: `supabase link --project-ref jipaumhvkldxnmwfdmji`. Obs.: a CLI e o histórico remoto usam versões de migração por timestamp; a migração `fix_select_after_insert` foi aplicada remotamente com versão própria — ao usar `supabase db pull`/`migration repair`, alinhe os nomes.
2. `supabase functions deploy admin-users` publica a função de administração de usuários (já publicada no projeto atual).
3. Crie o primeiro usuário em Authentication → Users (marque *Auto Confirm*) e, no SQL Editor, promova-o. Os demais são criados na tela **Usuários** do próprio Prisma (Edge Function `admin-users`):
   ```sql
   update public.profiles set role = 'admin', active = true where id = '<uuid-do-usuario>';
   ```
4. Authentication → URL Configuration: **Site URL** = `https://<seu-dominio>`; adicione-o em Redirect URLs.
5. Desative cadastro aberto (já em `config.toml`; replique no painel de produção). Ative backups no projeto de produção (RNF-06).

## 2. Variáveis
Somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas por desenho). Elas são embutidas **no build** — trocar de projeto Supabase exige novo build.

## 3. Publicação
**Automática (recomendada):** em GitHub → Settings → Secrets (environment `production`) crie
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `KINGHOST_FTP_HOST`, `KINGHOST_FTP_USER`, `KINGHOST_FTP_PASSWORD`, `KINGHOST_FTP_DIR`; depois rode o workflow *Deploy KingHost*.

**Manual:** `npm run build` e envie o conteúdo de `out/` (incluindo o `.htaccess`) para a pasta pública via FTP.

## 4. Verificações
- Domínio com HTTPS ativo (o `.htaccess` redireciona HTTP → HTTPS; confirme o SSL no painel da KingHost).
- Abrir `/projetos/` direto na barra de endereço funciona (cada rota é uma pasta com `index.html`).
- Edge Functions (Fase 4) ficam no Supabase — não dependem da KingHost.
