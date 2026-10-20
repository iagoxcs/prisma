# Deploy em produção (KingHost + Supabase)

Endereço: **https://prisma.ambienteconsulta.com.br**

## Como o sistema é dividido

| Parte | Onde roda | O que faz |
|---|---|---|
| Site (front) | KingHost, hospedagem Apache, só arquivos | HTML/JS/CSS gerados pelo build em `out/`. Sem Node, PHP ou banco na KingHost. |
| Backend | Supabase (`jipaumhvkldxnmwfdmji`) | Banco Postgres com RLS, login, arquivos, Realtime e Edge Functions (`supabase/functions/`). |
| Configuração do servidor | `public/.htaccess` (copiado para `out/`) | HTTPS obrigatório, rotas com barra final, página 404, cache e cabeçalhos de segurança. |

O navegador fala direto com o Supabase usando o login do usuário; a KingHost só entrega os arquivos.

**Fluxo automático:** cada merge em `main` dispara o workflow *Deploy produção* (`.github/workflows/deploy.yml`):

1. **Supabase:** aplica as migrações pendentes de `supabase/migrations/` (`supabase db push`) e publica as Edge Functions.
2. **Site:** só se o passo 1 passar, roda lint, typecheck, a trava das variáveis públicas, build, grava `out/version.txt` com o commit e envia `out/` por FTPS para a pasta do subdomínio (só os arquivos alterados).
3. **Conferência:** baixa `https://prisma.ambienteconsulta.com.br/version.txt` e falha se o domínio não estiver servindo o commit que acabou de subir (sinal de pasta errada).

Um deploy por vez, na ordem dos merges. Também dá para rodar manualmente em GitHub → Actions → *Deploy produção* → *Run workflow*.

---

## 1. KingHost (uma vez)

O domínio `ambienteconsulta.com.br` já usa o DNS da KingHost (`dns1…dns6.kinghost.com.br`) e `prisma.ambienteconsulta.com.br` já aponta para o servidor `191.6.222.10`. Falta garantir que o subdomínio tenha pasta própria e um acesso FTP que escreva nela.

1. **Subdomínio:** Painel de Controle KingHost → domínio `ambienteconsulta.com.br` → *Subdomínios*. Confira se `prisma` existe; se não, crie. Anote a **pasta** para onde ele aponta (algo como `/www/prisma` ou `/prisma`; o nome exato aparece no painel).
2. **PHP/Apache:** deixe o subdomínio como site comum (Apache). Não precisa de Node, banco MySQL nem PHP.
3. **SSL:** *SSL/TLS* (ou *Certificados*) → ative o certificado gratuito (Let's Encrypt) para `prisma.ambienteconsulta.com.br`. O `.htaccess` redireciona `http` → `https`, então o certificado precisa estar ativo antes do primeiro deploy.
4. **Acesso FTP:** *FTP* → use o usuário principal do domínio ou crie um usuário FTP com acesso à pasta do passo 1. Anote **host** (ex.: `ftp.ambienteconsulta.com.br`), **usuário** e **senha**.
5. **Teste do FTP** (opcional, no seu computador, com FileZilla em modo *FTP com TLS explícito*): entre com o usuário do passo 4, abra a pasta do subdomínio e crie/apague uma pasta de teste. Se der `550 Permission denied`, o usuário FTP não tem permissão na pasta (foi o que travou a tentativa de 06/10/2026); ajuste no painel antes de seguir.
6. **Limpe a pasta:** apague a página padrão da KingHost que estiver lá (hoje o subdomínio responde com uma página de julho/2024).

### 1.1 Supabase Auth
Supabase → Authentication → URL Configuration:
- **Site URL:** `https://prisma.ambienteconsulta.com.br`
- **Redirect URLs:** `https://prisma.ambienteconsulta.com.br/**` (remova a do Netlify depois que o novo endereço funcionar)

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
| `KINGHOST_FTP_HOST` | Host FTP (item 1, passo 4), sem `ftp://` |
| `KINGHOST_FTP_USER` | Usuário FTP |
| `KINGHOST_FTP_PASSWORD` | Senha FTP |
| `KINGHOST_FTP_DIR` | Pasta do subdomínio **vista pelo FTP** (item 1, passo 1), ex.: `/www/prisma/`. Nunca `/`. |

Pela linha de comando (o valor é pedido de forma oculta):
```bash
gh secret set KINGHOST_FTP_PASSWORD --env production
```

Os secrets `NETLIFY_AUTH_TOKEN` e `NETLIFY_SITE_ID` não são mais usados e podem ser removidos.

**Diagnóstico do FTP:** crie a *variável* (não secret) `FTP_LOG_LEVEL` = `verbose` no environment `production`. O deploy passa a listar as pastas da raiz da conta FTP e da pasta de destino, e mostra os comandos FTP. Útil para descobrir o valor certo de `KINGHOST_FTP_DIR`. Remova depois.

Nunca use a chave `service_role` em nenhum desses secrets nem no front.

**Trava automática:** antes e depois do build, o deploy roda `scripts/check-public-env.sh` e é cancelado se `NEXT_PUBLIC_SUPABASE_URL` não for `https://<ref>.supabase.co`, se `NEXT_PUBLIC_SUPABASE_ANON_KEY` for uma chave secreta (`sb_secret_…` ou JWT com papel diferente de `anon`), ou se `out/` contiver uma chave secreta. Motivo: em 06/10/2026 uma chave secreta foi cadastrada no lugar da publishable e chegou ao site. Para conferir localmente:
```bash
bash scripts/check-public-env.sh out
```

---

## 3. Regras para o deploy automático funcionar

- **Schema só por migração.** Alteração feita no painel do Supabase não entra no histórico e some no próximo ambiente.
- **Histórico alinhado:** cada versão registrada no Supabase precisa existir em `supabase/migrations/` com o mesmo número. Migração aplicada pelo MCP (`apply_migration`) é registrada com o horário da aplicação; renomeie o arquivo para a versão de `list_migrations`. Se o histórico divergir, `supabase db push` falha e o site **não** é publicado (seguro, mas trava o deploy).
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
- Depois de tudo certo, desative o projeto antigo no Netlify.
