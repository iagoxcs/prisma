# Deploy em produção (KingHost + Supabase)

O build gera a pasta `out/` (HTML/JS/CSS). Ela é publicada na raiz do site; não há processo Node no servidor.
Banco, autenticação, arquivos e Edge Functions ficam no Supabase.

**Fluxo automático:** cada merge em `main` dispara o workflow *Deploy produção* (`.github/workflows/deploy-kinghost.yml`):

1. **Supabase:** aplica as migrações pendentes de `supabase/migrations/` (`supabase db push`) e publica as Edge Functions.
2. **Site:** só se o passo 1 passar, roda lint, typecheck e build e envia `out/` por FTPS para a KingHost.

Um deploy por vez, na ordem dos merges. Também dá para rodar manualmente em GitHub → Actions → *Deploy produção* → *Run workflow*.

---

## Situação atual (06/10/2026)

**Endereço pretendido:** `https://prisma.ambienteconsultoria.com.br` (subdomínio; não exige mudança no código, pois o site usa caminhos a partir da raiz).

| Item | Estado |
|---|---|
| Secrets do environment `production` | 9 de 9 cadastrados |
| Job Supabase do deploy | ✅ passa (migrações em dia; Edge Function `admin-users` publicada) |
| Job Site (FTPS) | ❌ falha: login funciona, mas a conta FTP não tem pasta do site |
| DNS de `ambienteconsultoria.com.br` | Sem registros `A`/`www`; nameservers do Registro.br (`a.auto.dns.br`, `b.auto.dns.br`) |
| Subdomínio `prisma` | Não existe no DNS |
| SSL / Supabase Auth (Site URL) | Pendentes (dependem do DNS) |

**Diagnóstico do FTP** (log detalhado do deploy): servidor `web1009.kinghost.net` (IP `191.6.222.10`); ao entrar, a raiz da conta está **vazia**, `www` não existe e `MKD` retorna `550 Permission denied`. A hospedagem não tem um site configurado para este domínio, ou o usuário FTP não é o da hospedagem do site.

**Bloqueio:** o DNS do domínio é editado no Registro.br, e o acesso está com a titular do domínio (contatos administrativo e técnico no Registro.br). Sem esse acesso, nenhum serviço responde no domínio ou em subdomínios dele.

**Próximos passos**
1. **KingHost:** cadastrar `prisma.ambienteconsultoria.com.br` como site na hospedagem; anotar IP do servidor, usuário FTP e pasta pública.
2. **Registro.br** (titular, ou você após ser incluído como contato técnico): na zona DNS, criar `A` `prisma` → IP da KingHost (provavelmente `191.6.222.10`; confirmar no painel).
3. **KingHost:** após a propagação, ativar o SSL do subdomínio.
4. **Supabase Auth:** Site URL `https://prisma.ambienteconsultoria.com.br` e Redirect URL `https://prisma.ambienteconsultoria.com.br/**`.
5. **GitHub:** atualizar `KINGHOST_FTP_USER`, `KINGHOST_FTP_PASSWORD` e `KINGHOST_FTP_DIR` e rodar *Deploy produção* manualmente.
6. Com o deploy verde, remover a variável `FTP_LOG_LEVEL` do environment `production` (hoje `verbose`, para diagnóstico; o repositório é público e o log fica visível).

**Alternativa provisória** (sem domínio próprio): publicar em Cloudflare Pages ou Netlify (`*.pages.dev` / `*.netlify.app`), com HTTPS automático, até o DNS ser liberado.

**Observação:** o `MX` do domínio é `.` (null MX): o domínio não recebe e-mail. Se houver endereços `@ambienteconsultoria.com.br` em uso, as mensagens não chegam.

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

### 1.2.1 Subdomínio (ex.: `prisma.ambienteconsultoria.com.br`)
- Cadastre o subdomínio como site na KingHost; ela cria a pasta pública dele na conta FTP da hospedagem. Use essa pasta em `KINGHOST_FTP_DIR` e o usuário FTP dessa hospedagem.
- Se o DNS **não** estiver na KingHost (caso atual: Registro.br), crie o registro manualmente no provedor de DNS: `A` com nome `prisma` (só o prefixo) apontando para o IP do servidor.
- O SSL do domínio principal não cobre subdomínios (exceto certificado *wildcard*): ative o SSL também para o subdomínio.
- Publicar em subcaminho (`dominio/prisma`) exigiria `basePath` no `next.config.ts`; subdomínio não.

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
