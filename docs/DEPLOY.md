# Deploy em produção (Netlify + Supabase)

O build gera a pasta `out/` (HTML/JS/CSS). Ela é publicada no Netlify; não há processo Node no servidor.
Banco, autenticação, arquivos e Edge Functions ficam no Supabase.

**Fluxo automático:** cada merge em `main` dispara o workflow *Deploy produção* (`.github/workflows/deploy.yml`):

1. **Supabase:** aplica as migrações pendentes de `supabase/migrations/` (`supabase db push`) e publica as Edge Functions.
2. **Site:** só se o passo 1 passar, roda lint, typecheck e build e envia `out/` para o Netlify (`netlify deploy --prod --no-build`).

Um deploy por vez, na ordem dos merges. Também dá para rodar manualmente em GitHub → Actions → *Deploy produção* → *Run workflow*.

O build é feito no GitHub Actions, não no Netlify: o projeto do Netlify **não** deve ser ligado ao repositório (*Import from Git*), senão os dois publicam em paralelo e o site pode subir antes das migrações.

---

## 1. Projeto no Netlify (uma vez)

1. Entre em app.netlify.com (login com a conta do GitHub; plano gratuito atende).
2. *Add new project* → *Deploy manually* → arraste a pasta `out/` de um build local. Isso só cria o projeto; o próximo deploy substitui o conteúdo.
3. *Project configuration* → *General* → *Change project name*: ex. `prisma-ambiente` → `https://prisma-ambiente.netlify.app`.
4. Anote o **Project ID** (mesma tela).
5. *User settings* → *Applications* → *Personal access tokens* → *New access token*. Guarde o token (só aparece uma vez).

HTTPS e redirecionamento `http` → `https` são automáticos. Cabeçalhos de segurança e cache ficam em `public/_headers` (copiado para `out/` no build). A página `404.html` é usada automaticamente.

### 1.1 Supabase Auth
Supabase → Authentication → URL Configuration:
- **Site URL:** `https://<projeto>.netlify.app`
- **Redirect URLs:** `https://<projeto>.netlify.app/**`

Mantenha o cadastro aberto desativado (Authentication → Sign In / Providers → *Allow new users to sign up* desligado) e ative backups (RNF-06).

### 1.2 Domínio próprio (opcional, depois)
Para usar `prisma.ambienteconsultoria.com.br`:
1. Netlify → *Domain management* → *Add a domain* → informe o subdomínio.
2. No provedor de DNS do domínio (hoje o Registro.br, nameservers `a.auto.dns.br` / `b.auto.dns.br`; o acesso está com a titular do domínio): crie `CNAME` `prisma` → `<projeto>.netlify.app`.
3. Após a propagação, o Netlify emite o certificado sozinho. Confira com `nslookup prisma.ambienteconsultoria.com.br`.
4. Troque Site URL e Redirect URLs do Supabase Auth (item 1.1) para o novo endereço.

Observação: o `MX` de `ambienteconsultoria.com.br` é `.` (null MX), ou seja, o domínio não recebe e-mail.

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
| `NETLIFY_AUTH_TOKEN` | Token pessoal do Netlify (item 1, passo 5) |
| `NETLIFY_SITE_ID` | Project ID do Netlify (item 1, passo 4) |

Pela linha de comando (o valor é pedido de forma oculta):
```bash
gh secret set NETLIFY_AUTH_TOKEN --env production
```

Nunca use a chave `service_role` em nenhum desses secrets nem no front.

Os secrets `KINGHOST_FTP_*` e a variável `FTP_LOG_LEVEL` não são mais usados e podem ser removidos.

---

## 3. Regras para o deploy automático funcionar

- **Schema só por migração.** Alteração feita no painel do Supabase não entra no histórico e some no próximo ambiente.
- **Histórico alinhado:** cada versão registrada no Supabase precisa existir em `supabase/migrations/` com o mesmo número. Migração aplicada pelo MCP (`apply_migration`) é registrada com o horário da aplicação; renomeie o arquivo para a versão de `list_migrations`. Se o histórico divergir, `supabase db push` falha e o site **não** é publicado (seguro, mas trava o deploy).
- **Primeiro usuário:** crie em Authentication → Users (*Auto Confirm*) e promova no SQL Editor; os demais entram pela tela Configurações → Usuários:
  ```sql
  update public.profiles set role = 'admin', active = true where id = '<uuid-do-usuario>';
  ```

## 4. Publicação manual (contingência)
`npm run build` com as variáveis `NEXT_PUBLIC_*` de produção e depois:
```bash
npx netlify-cli@27 deploy --prod --no-build --dir=out --site=<project-id>
```
Ou arraste a pasta `out/` em Netlify → *Deploys*.

## 5. Verificações após o primeiro deploy
- `https://<projeto>.netlify.app` abre com cadeado; `http://` redireciona para `https://`.
- Abrir `/projetos/` direto na barra de endereço funciona (cada rota é uma pasta com `index.html`).
- Cabeçalhos aplicados: `curl -sI https://<projeto>.netlify.app/ | grep -i x-frame` retorna `DENY`.
- Login funciona (se falhar com erro de redirecionamento, revise o item 1.1).

---

## Anexo: KingHost (alternativa não usada)
A tentativa de publicar na KingHost (FTP) parou em 06/10/2026: a conta FTP entrava, mas não tinha pasta de site (`550 Permission denied` ao criar `_next/`), e o subdomínio não existia no DNS. O `public/.htaccess` continua no projeto para o caso de voltar a ela; nesse caso, é preciso cadastrar o subdomínio como site no painel da KingHost, criar o registro `A` `prisma` → IP do servidor no DNS, ativar o SSL do subdomínio e restaurar o envio por FTPS do histórico do workflow (`git log -- .github/workflows/deploy-kinghost.yml`).
