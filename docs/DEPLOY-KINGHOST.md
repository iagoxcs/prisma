# Deploy em produção (KingHost + Supabase)

O build gera a pasta `out/` (HTML/JS/CSS). Ela é publicada na raiz do site; não há processo Node no servidor.
Banco, autenticação, arquivos e Edge Functions ficam no Supabase.

**Fluxo automático:** cada merge em `main` dispara o workflow *Deploy produção* (`.github/workflows/deploy-kinghost.yml`):

1. **Supabase:** aplica as migrações pendentes de `supabase/migrations/` (`supabase db push`) e publica as Edge Functions.
2. **Site:** só se o passo 1 passar, roda lint, typecheck e build e envia `out/` por FTPS para a KingHost.

Um deploy por vez, na ordem dos merges. Também dá para rodar manualmente em GitHub → Actions → *Deploy produção* → *Run workflow*.

---

## 1. Domínio próprio (uma vez)

### 1.1 Hospedagem na KingHost
1. No painel da KingHost, contrate/adicione o domínio (ex.: `prisma.ambienteconsultoria.com.br`) a um plano de hospedagem de site.
2. Anote no painel: **endereço IP do servidor**, **host FTP**, **usuário FTP** e a **pasta pública** do site (ex.: `/www/` ou `/public_html/`). Defina ou redefina a senha FTP ali.

### 1.2 DNS
Os valores vêm do painel da KingHost (não são gerados pelo projeto). Duas opções:

- **DNS gerenciado pela KingHost:** no registro do domínio (Registro.br ou outro), troque os *nameservers* pelos que o painel da KingHost indicar. A KingHost cria os registros sozinha.
- **DNS em outro provedor** (Cloudflare, Registro.br etc.): crie os registros apontando para o IP do item 1.1.

  | Tipo | Nome | Valor |
  |---|---|---|
  | `A` | `prisma` (subdomínio) ou `@` (domínio raiz) | IP do servidor KingHost |
  | `CNAME` | `www` (só se usar domínio raiz) | o domínio raiz |

  Na Cloudflare, deixe o registro como *DNS only* (nuvem cinza) até o SSL estar emitido.

A propagação leva de minutos a algumas horas. Para conferir: `nslookup <seu-dominio>`.

### 1.3 HTTPS
Depois que o DNS propagar, ative o certificado SSL gratuito (Let's Encrypt) no painel da KingHost para o domínio.
O `public/.htaccess` (copiado para `out/` no build) já redireciona HTTP → HTTPS e define cache e cabeçalhos de segurança.

### 1.4 Supabase Auth
Supabase → Authentication → URL Configuration:
- **Site URL:** `https://<seu-dominio>`
- **Redirect URLs:** `https://<seu-dominio>/**`

Mantenha o cadastro aberto desativado (Authentication → Sign In / Providers → *Allow new users to sign up* desligado) e ative backups (RNF-06).

---

## 2. Segredos do GitHub (uma vez)

GitHub → Settings → Environments → **production** → *Environment secrets*. Recomendado: em *Deployment branches*, permitir só `main`.

| Secret | Onde obter |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens → *Generate new token* |
| `SUPABASE_DB_PASSWORD` | Senha do banco (Project Settings → Database; dá para redefinir ali) |
| `SUPABASE_PROJECT_REF` | `jipaumhvkldxnmwfdmji` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://jipaumhvkldxnmwfdmji.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → chave `anon`/publishable (pública por desenho) |
| `KINGHOST_FTP_HOST` | Painel KingHost (item 1.1) |
| `KINGHOST_FTP_USER` | Painel KingHost |
| `KINGHOST_FTP_PASSWORD` | Painel KingHost |
| `KINGHOST_FTP_DIR` | Pasta pública, com barra no fim (ex.: `/www/`) |

Pela linha de comando (o valor é pedido de forma oculta):
```bash
gh secret set SUPABASE_ACCESS_TOKEN --env production
```

Nunca use a chave `service_role` em nenhum desses secrets nem no front.

---

## 3. Regras para o deploy automático funcionar

- **Schema só por migração.** Alteração feita no painel do Supabase não entra no histórico e some no próximo ambiente.
- **Histórico alinhado:** cada versão registrada no Supabase precisa existir em `supabase/migrations/` com o mesmo número. Migração aplicada pelo MCP (`apply_migration`) é registrada com o horário da aplicação; renomeie o arquivo para a versão de `list_migrations`. Se o histórico divergir, `supabase db push` falha e o site **não** é publicado (seguro, mas trava o deploy).
- **Primeiro usuário:** crie em Authentication → Users (*Auto Confirm*) e promova no SQL Editor; os demais entram pela tela Configurações → Usuários:
  ```sql
  update public.profiles set role = 'admin', active = true where id = '<uuid-do-usuario>';
  ```

## 4. Publicação manual (contingência)
`npm run build` com as variáveis `NEXT_PUBLIC_*` de produção e envio do conteúdo de `out/` (incluindo `.htaccess`) para a pasta pública via FTP.

## 5. Verificações após o primeiro deploy
- `https://<seu-dominio>` abre com cadeado; `http://` redireciona para `https://`.
- Abrir `/projetos/` direto na barra de endereço funciona (cada rota é uma pasta com `index.html`).
- Login funciona (se falhar com erro de redirecionamento, revise o item 1.4).
