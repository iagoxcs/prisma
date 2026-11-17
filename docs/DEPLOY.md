# Deploy em produção (KingHost + Supabase)

Endereço: **https://prisma.ambienteconsulta.com.br**

## Como o sistema é dividido

| Parte | Onde roda | O que faz |
|---|---|---|
| Site (front) | KingHost, hospedagem Apache, só arquivos | HTML/JS/CSS gerados pelo build em `out/`. Sem Node, PHP ou banco na KingHost. |
| Backend | Supabase (`jipaumhvkldxnmwfdmji`) | Banco Postgres com RLS, login, arquivos, Realtime e Edge Functions (`supabase/functions/`). |
| Configuração do servidor | `public/.htaccess` (copiado para `out/` no build) | Fonte única de HTTPS obrigatório, cabeçalhos de segurança, cache, rotas com barra final e página 404. |

O navegador fala direto com o Supabase usando o login do usuário; a KingHost só entrega os arquivos.

**Fluxo automático:** cada merge em `main` dispara o workflow *Deploy produção* (`.github/workflows/deploy.yml`), com dois jobs no environment `production`:

1. **Supabase (migrações e Edge Functions):** `supabase link`, prévia com `supabase db push --dry-run`, aplicação com `supabase db push` e `supabase functions deploy`. É o único caminho pelo qual migrações chegam ao banco.
2. **Site (KingHost):** só roda se o job 1 passar. Executa `npm ci`, lint, typecheck, *Conferir variáveis públicas*, build, *Conferir o build (sem chave secreta em ./out)*, *Gravar versão* (`out/version.txt` com o commit), *Pasta de destino* (valida `KINGHOST_FTP_DIR`) e *Enviar ./out por FTPS* (`SamKirkland/FTP-Deploy-Action`, só arquivos alterados).
   O envio tenta até 3 vezes, com 45 s entre as tentativas, porque a conexão FTP com a KingHost às vezes falha (`connect ETIMEDOUT 191.6.222.10:21`); uma tentativa que falhou aparece como aviso no job, e só a falha da 3ª derruba o deploy.
3. **Conferir o site no ar** (último passo do job 2): baixa `https://prisma.ambienteconsulta.com.br/version.txt` e falha se o domínio não servir o commit recém-enviado (sinal de pasta errada); avisa se `X-Frame-Options: DENY` não vier (sinal de `.htaccess` inativo).

Um deploy por vez, na ordem dos merges. Também dá para rodar manualmente em GitHub → Actions → *Deploy produção* → *Run workflow*.

---

## 1. KingHost (uma vez)

O domínio `ambienteconsulta.com.br` já usa o DNS da KingHost (`dns1…dns6.kinghost.com.br`) e `prisma.ambienteconsulta.com.br` já aponta para o servidor `191.6.222.10`. Falta garantir que o subdomínio tenha pasta própria e um acesso FTP que escreva nela.

1. **Subdomínio:** Painel de Controle KingHost → domínio `ambienteconsulta.com.br` → *Subdomínios* → `prisma`. A pasta do site é `/www/prisma/` (vista pelo FTP). Atenção: `/prisma/` na raiz do FTP **não** é servida pelo subdomínio.
2. **PHP/Apache:** deixe o subdomínio como site comum (Apache). Não precisa de Node, banco MySQL nem PHP.
3. **SSL:** *SSL/TLS* (ou *Certificados*) → ative o certificado gratuito (Let's Encrypt) para `prisma.ambienteconsulta.com.br`. O `.htaccess` redireciona `http` → `https`, então o certificado precisa estar ativo antes do primeiro deploy.
4. **Acesso FTP:** *FTP* → use o usuário principal do domínio ou crie um usuário FTP com acesso à pasta do passo 1. Anote **host** (ex.: `ftp.ambienteconsulta.com.br`), **usuário** e **senha**.
   **Política de IPs do FTP:** deixe *sem bloqueio*. Os runners do GitHub ficam fora do Brasil; com restrição, o login é aceito, mas `CWD /` retorna `550 No such file or directory` e nada é enviado (ocorrido em 20/10/2026).
5. **Teste do FTP** (opcional, no seu computador, com FileZilla em modo *FTP com TLS explícito*): entre com o usuário do passo 4, abra a pasta do subdomínio e crie/apague uma pasta de teste. Se der `550 Permission denied`, o usuário FTP não tem permissão na pasta (foi o que travou a tentativa de 06/10/2026); ajuste no painel antes de seguir.
6. **Limpe a pasta:** apague a página padrão da KingHost (*Site em construção*) antes do primeiro deploy.

### 1.1 Supabase Auth
Supabase → Authentication → URL Configuration:
- **Site URL:** `https://prisma.ambienteconsulta.com.br`
- **Redirect URLs:** `https://prisma.ambienteconsulta.com.br/**`

Mantenha o cadastro aberto desativado (Authentication → Sign In / Providers → *Allow new users to sign up* desligado) e ative backups (RNF-06).

### 1.2 E-mail (Resend)
O Prisma envia dois tipos de e-mail, ambos pelo Resend e a partir do domínio já verificado lá:

| E-mail | Quem envia | Configuração |
|---|---|---|
| Recuperar senha, troca de e-mail | Supabase Auth, via SMTP do Resend | Painel do Supabase (abaixo) |
| Alertas de prazo (resumo diário às 08:05) | Edge Function `deadline-emails`, via API do Resend | Secrets da função (abaixo) |

**a) SMTP do Auth.** Supabase → Authentication → Emails → *SMTP Settings* → *Enable custom SMTP*:
- Host `smtp.resend.com`, porta `465`, usuário `resend`, senha = chave da API do Resend (resend.com → API Keys, permissão *Sending access*).
- Sender email: um endereço do domínio verificado (ex.: `prisma@<domínio>`); Sender name: `Prisma · Ambiente Consultoria`.

Depois, em Authentication → *Rate Limits*, suba *Rate limit for sending emails* (ex.: 30/h). O limite de 2/h vale só para o SMTP embutido.

**b) Templates em pt-BR.** Authentication → Emails → *Templates*: cole o conteúdo e o assunto de
- *Reset Password*: `supabase/templates/recovery.html`, assunto `Prisma: redefinir sua senha`
- *Change Email Address*: `supabase/templates/email_change.html`, assunto `Prisma: confirme seu novo e-mail`

Os arquivos são a fonte. Ao mudar um, cole de novo no painel. O link de recuperação aponta para `/redefinir-senha/?token_hash=…`, que valida o token no navegador (funciona no site estático). Por isso, o *Site URL* do item 1.1 precisa ser o domínio de produção. A tela também aceita o link do template padrão do Supabase (`?code=…`, fluxo PKCE), mas esse só funciona se for aberto no mesmo navegador em que a recuperação foi pedida; com o template do repositório, funciona em qualquer navegador.

**c) Secrets da Edge Function** (uma vez, fora do GitHub):
```bash
npx supabase secrets set --project-ref jipaumhvkldxnmwfdmji RESEND_API_KEY=<chave> EMAIL_FROM="Prisma <prisma@dominio-verificado>"
```
Também dá para fazer em Supabase → Edge Functions → *Secrets*. A chave do Resend nunca vai para secrets do GitHub nem para `NEXT_PUBLIC_*`.

**Como o alerta por e-mail funciona.** O job `prisma-deadline-notifications` (08:00) gera as notificações. O job `prisma-deadline-emails` (08:05, migração `20261020134510_deadline_emails`) chama a função com o cabeçalho `x-cron-secret`. Esse segredo foi gerado pela própria migração no Vault (`prisma_cron_secret`); não há passo manual. A função manda um resumo por pessoa com as notificações `due_soon`/`overdue` dos últimos 2 dias ainda não enviadas e marca `notifications.emailed_at`. O envio liga e desliga em Configurações → Parâmetros → *Também enviar os alertas por e-mail*.

**Testar:** em Integrations → Cron → `prisma-deadline-emails` → *Run*; resultado em Edge Functions → `deadline-emails` → *Logs* (`{ sent, failed }`). Sem pendências, a resposta é `sent: 0`. Se der 500 com "defina RESEND_API_KEY", falta o passo c.

### 1.3 URL das funções por ambiente
O job `prisma-deadline-emails` lê a base das Edge Functions do segredo `prisma_functions_url` no Vault (migração `20261117202543_cron_functions_url`). Sem o segredo, o job roda sem chamar nada e os e-mails de prazo param sem erro aparente.

Crie uma vez por ambiente, no SQL Editor, trocando `<ref>` (produção `jipaumhvkldxnmwfdmji`; homologação `acdqtnquxnrirqgnygsu`):
```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'prisma_functions_url', 'Base das Edge Functions chamadas pelo pg_cron');
```

> **Atenção:** crie o segredo em produção **antes do merge** da PR que traz essa migração. Sem ele, os e-mails de prazo param a partir do deploy.

Para conferir: `select name from vault.secrets where name = 'prisma_functions_url';`

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
| `KINGHOST_FTP_HOST` | Host FTP (item 1, passo 4), sem `ftp://` |
| `KINGHOST_FTP_USER` | Usuário FTP |
| `KINGHOST_FTP_PASSWORD` | Senha FTP |
| `KINGHOST_FTP_DIR` | `/www/prisma/` (pasta do subdomínio vista pelo FTP, item 1, passo 1). Nunca `/`. |

Pela linha de comando (o valor é pedido de forma oculta):
```bash
gh secret set KINGHOST_FTP_PASSWORD --env production
```

**Diagnóstico do FTP:** crie a *variável* (não secret) `FTP_LOG_LEVEL` = `verbose` no environment `production`. O deploy passa a listar as pastas da raiz da conta FTP e da pasta de destino, e mostra os comandos FTP. Útil para descobrir o valor certo de `KINGHOST_FTP_DIR`. Remova depois.

Nunca use a chave `service_role` em nenhum desses secrets nem no front.

**Trava automática:** antes e depois do build, o deploy roda `scripts/check-public-env.sh` e é cancelado se `NEXT_PUBLIC_SUPABASE_URL` não for `https://<ref>.supabase.co`, se `NEXT_PUBLIC_SUPABASE_ANON_KEY` for uma chave secreta (`sb_secret_…` ou JWT com papel diferente de `anon`), ou se `out/` contiver uma chave secreta. Motivo: em 06/10/2026 uma chave secreta foi cadastrada no lugar da publishable e chegou ao site. Para conferir localmente:
```bash
bash scripts/check-public-env.sh out
```

---

## 3. Regras para o deploy automático funcionar

- **Schema só por migração.** Alteração feita no painel do Supabase não entra no histórico e some no próximo ambiente.
- **Migrações só pelo workflow:** há um único projeto Supabase e ele é produção. Proibido `apply_migration` pelo MCP; a migração entra em `supabase/migrations/` por PR e chega ao banco no `supabase db push` do deploy, após o merge em `main`.
- **Histórico alinhado:** cada versão registrada no Supabase precisa existir em `supabase/migrations/` com o mesmo número. Se o histórico divergir, `supabase db push` falha e o site **não** é publicado (seguro, mas trava o deploy).
- **Não edite arquivos direto no FTP.** O envio é incremental e guarda o estado em `.ftp-deploy-sync-state.json` na pasta do site; mudança manual lá fica fora desse controle. Se precisar forçar o envio completo, apague esse arquivo pelo FTP e rode o workflow de novo.
- **Primeiro usuário:** crie em Authentication → Users (*Auto Confirm*) e promova no SQL Editor; os demais entram pela tela Configurações → Usuários:
  ```sql
  update public.profiles set role = 'admin', active = true where id = '<uuid-do-usuario>';
  ```

## 4. Publicação manual (contingência)
`npm run build` com as variáveis `NEXT_PUBLIC_*` de produção e envie **o conteúdo** de `out/` (inclusive o arquivo oculto `.htaccess`) para a pasta do subdomínio com o FileZilla. Depois apague `.ftp-deploy-sync-state.json` da pasta, para o próximo deploy automático reenviar tudo.

## 5. Verificações após o primeiro deploy
- `https://prisma.ambienteconsulta.com.br` abre com cadeado; `http://` redireciona para `https://`.
- Abrir `/projetos/` direto na barra de endereço funciona (cada rota é uma pasta com `index.html`); `/projetos` sem barra redireciona.
- Cabeçalhos aplicados (o workflow também confere e avisa):
  ```bash
  curl -sI https://prisma.ambienteconsulta.com.br/ | grep -i x-frame
  ```
  deve retornar `DENY`.
- `https://prisma.ambienteconsulta.com.br/.ftp-deploy-sync-state.json` retorna 403.
- Login funciona (se falhar com erro de redirecionamento, revise o item 1.1).
- `https://prisma.ambienteconsulta.com.br/version.txt` mostra o commit do último deploy.

## 6. Migração de chaves

O Supabase substituiu as chaves de API `anon` e `service_role` (JWTs assinados pela chave HS256 do projeto) pelas chaves `sb_publishable_…` e `sb_secret_…`. As legadas funcionam até o fim de 2026. Os JWT de sessão já são assinados em ES256 desde 05/10/2026.

| Passo | O quê | Situação |
|---|---|---|
| 1 | Site com a chave publishable: secret `NEXT_PUBLIC_SUPABASE_ANON_KEY` do GitHub = `sb_publishable_…` (o nome do secret ficou o antigo) | Feito em 26/10/2026 |
| 2 | Edge Functions com as chaves novas (`SUPABASE_SECRET_KEYS` e `SUPABASE_PUBLISHABLE_KEYS`, chave `default`), com retorno às legadas se faltarem | Feito em 13/11/2026 |
| 3 | Desativar as legadas e revogar a HS256 | Após uma semana sem erro |

Quem depende de chave de API: só as três Edge Functions. O `pg_cron` chama o `deadline-emails` com o cabeçalho `x-cron-secret`; o Hermes e a rotina chamam o `ai-gateway` com `HERMES_GATEWAY_SECRET` e `ROUTINE_SECRET`; o deploy usa a senha do banco e o token da CLI.

**Passo 3, no painel do Supabase**, só depois de uma semana sem erro nos logs das funções:

1. Em *Edge Functions → Logs*, conferir em `admin-users`, `ai-gateway` e `deadline-emails` as linhas `chave de API secret: nova` e `chave de API publishable: nova`. Nenhuma pode dizer `legada`.
2. *Settings → API Keys → Legacy API keys*: desativar `anon` e `service_role`. É reversível.
3. Testar logo em seguida: login no site, *Configurações → Usuários* (usa o `admin-users`), uma consulta ao bot por DM (usa o `ai-gateway`) e, no dia seguinte, o relatório da rotina em `#prisma-operacao` e os e-mails de prazo. Se algo falhar, reativar as legadas e investigar.
4. Depois de mais alguns dias sem erro: *Settings → JWT Signing Keys → Previously used*, revogar a chave HS256. **Irreversível**: invalida qualquer token assinado por ela, inclusive as chaves legadas.
5. Opcional: remover das funções o retorno às chaves legadas.

---

## 7. Homologação

Projeto Supabase `prisma-hml` (`acdqtnquxnrirqgnygsu`). O workflow *Deploy homologação* (`.github/workflows/deploy-homolog.yml`) roda a cada push na branch `homolog` (ou manualmente em Actions → *Run workflow*) e faz o mesmo que o job Supabase da produção: `link`, `db push --dry-run`, `db push` e `functions deploy`. Não publica site.

**a) Environment `homolog` no GitHub** (Settings → Environments → *New environment*; em *Deployment branches*, permitir só `homolog`):

| Secret | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Token da CLI (pode ser o mesmo da produção) |
| `SUPABASE_DB_PASSWORD` | Senha do banco da `prisma-hml` |
| `SUPABASE_PROJECT_REF` | `acdqtnquxnrirqgnygsu` |

**b) Segredos das Edge Functions na hml**, com valores próprios, nunca os da produção:
```bash
npx supabase secrets set --project-ref acdqtnquxnrirqgnygsu RESEND_API_KEY=<chave> EMAIL_FROM="Prisma HML <prisma@dominio-verificado>" HERMES_GATEWAY_SECRET=<valor> ROUTINE_SECRET=<valor>
```

**c) URL das funções:** crie o segredo `prisma_functions_url` como no item 1.3, com `<ref>` = `acdqtnquxnrirqgnygsu`.

**d) Auth da hml:** Authentication → Sign In / Providers → *Allow new users to sign up* **desligado**; URL Configuration → *Site URL* `http://localhost:3000` e *Redirect URLs* `http://localhost:3000/**`.

**e) Front local apontando para a hml:** em `.env.local` (fora do Git):
```
NEXT_PUBLIC_SUPABASE_URL=https://acdqtnquxnrirqgnygsu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<chave publishable da prisma-hml>
```
Depois, `npm run dev`.

**f) Dados de teste:** pelo `execute_sql` do Supabase MCP, só DML (insert, update, delete). Nada de DDL (create, alter, drop, grant, policy): o schema só muda por migração.

**Fluxo:** branch de trabalho → merge em `homolog` (deploy automático na hml) → teste → PR da branch de trabalho para `main` (deploy em produção).

---

## Anexo: Netlify (descontinuado)
De 06/10 a 19/10/2026 o site foi publicado no Netlify (`netlify deploy --prod --no-build --dir=out`, projeto `prisma-ambiente`, endereço `https://prisma-ambiente.netlify.app`), com cabeçalhos em `public/_headers`. Substituído pela KingHost em 20/10/2026 (PR #19); `public/_headers` foi removido.

Limpeza pendente:
- GitHub → environment `production`: remover os secrets `NETLIFY_AUTH_TOKEN` e `NETLIFY_SITE_ID`.
- Netlify: desativar o projeto `prisma-ambiente` e desligar a integração com o repositório (ela ainda gera checks nos PRs).
- Supabase Auth: remover a Redirect URL `https://prisma-ambiente.netlify.app/**`.
- O domínio `ambienteconsultoria.com.br` (Registro.br), citado no plano antigo, não é usado; o Prisma fica em `ambienteconsulta.com.br`.
