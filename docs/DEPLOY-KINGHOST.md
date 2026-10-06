# Deploy na KingHost (site estático)

O build gera a pasta `out/` (HTML/JS/CSS). Basta publicá-la na raiz do site; não há processo Node no servidor.

## 1. Supabase
1. `supabase login` e `supabase link --project-ref <ref>` (use projetos **separados** para dev e prod).
2. `supabase db push` aplica as migrações.
3. Crie o primeiro usuário em Authentication → Users, depois no SQL Editor:
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
