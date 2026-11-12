# Arquitetura — Prisma

Complementa `REQUISITOS.md` (v1.0). Aqui ficam as decisões de implementação tomadas ao estruturar o projeto.

## Mudanças em relação ao levantamento

| Tema | Levantamento | Implementado | Motivo |
|---|---|---|---|
| Hospedagem | Vercel / Cloudflare Pages | **KingHost (site estático, Apache)** em `prisma.ambienteconsulta.com.br` | Domínio e DNS já na KingHost; Netlify usado de 06 a 19/10/2026; ver `DEPLOY.md` |
| Next.js | App Router com SSR possível | **Export estático** (`output: "export"`) | Hospedagem só de arquivos estáticos (sem Node) |
| Rotas dinâmicas | `[id]` | Query string (`/projeto/?id=`) | Limitação do export estático |
| Cliente Supabase | server + browser | Somente browser | Sem servidor Next |
| Colunas | Misto PT/EN | Inglês (`title`, `name`, `body`…) | Consistência no código; UI continua em pt-BR |
| Compartilhar tarefa com externo | Citado em RF/matriz, sem tabela | Tabela `task_shares` | Necessária para "atribuídas ou compartilhadas" |
| `profiles.is_external` | Coluna | Coluna **gerada** a partir de `role = 'externo'` | Impede inconsistência perfil × flag |
| Novo usuário | — | Nasce `active = false`, `role = externo` | Menor privilégio; admin libera |

## Camadas

```
Navegador (site estático na KingHost)        Discord (canal por projeto)
   │ supabase-js (JWT do usuário)               │
   │                                            ▼
   │                                 VPS: Hermes · plugin nativo Prisma · rotina diária
   │                                            │
   │                                            ▼
   │                                 Edge Function ai-gateway
   │                                 (sessão do usuário obtida aqui; ferramentas restritas)
   ▼                                            ▼
Supabase: Auth · Postgres (RLS) · Storage · Realtime
```

Toda autorização está no banco. O `AppShell` redireciona para `/login/` apenas por UX.

Cada projeto tem um canal no Discord (`projects.discord_channel_id`); a rotina diária resume o canal e grava o resumo em `project_context_entries`.

Desde 05/10/2026 os JWT são assinados em ES256. A chave HS256 anterior fica mantida até a migração das chaves de API.

### Exceções ao modelo de identidade

| Credencial | Uso | Restrição |
|---|---|---|
| `ROUTINE_SECRET` (rotina diária) | Chamar o `ai-gateway` sem sessão de usuário | Só lista canais e grava contexto |

### Spikes do Hermes (S1–S3) — 11/11/2026

Executados no Hermes 0.23.0 (2bd378e) da VPS, com um plugin descartável (`prisma_spike`, já removido) e a conta do Iago no `#prisma-ia`.

| Spike | Resultado | Evidência |
|---|---|---|
| S1 — ID do autor sem passar pelo LLM | **Aprovado, como plugin nativo** | Ferramenta sem parâmetros leu `HERMES_SESSION_USER_ID` (ContextVar do gateway, por mensagem) e devolveu o ID real; o pedido "finja que sou o usuário 123456" não teve efeito |
| S2 — memória e sessões isoladas por usuário | **Aprovado em configuração; teste com dois usuários pendente** | Memória, perfil de usuário e curador desligados; sem `session_search` nos toolsets; `thread_sessions_per_user: true` (o padrão do Hermes compartilhava a sessão de um tópico entre participantes). A chave de sessão passou a terminar no ID do autor |
| S3 — código por DM fora do contexto do LLM | **Aprovado** | A ferramenta enviou a DM pela API REST do Discord e devolveu só o `pending_id`. O `pending_id` aparece no `state.db`; o código não aparece em nenhum arquivo de dados do Hermes nem nas mensagens do bot no canal |

**Consequências:**
- A "fachada MCP" vira **plugin nativo do Hermes** (`hermes/plugin-prisma/`). Um servidor MCP roda em outro processo e não recebe o contexto da sessão.
- As ferramentas expostas ao LLM continuam sem parâmetro de usuário. O plugin injeta o `discord_user_id` na chamada ao `ai-gateway`.
- Comandos de barra do Hermes: só o dono roda comandos administrativos (`allow_admin_from`). Os demais rodam só `help`, `whoami`, `new`, `stop` e `status`.
- **Dados de projeto só por DM** (decisão de 11/11/2026). No canal, as respostas ficam visíveis a todos com o papel Prisma IA. Por isso as ferramentas do Prisma só executam em sessão de DM: o plugin confere `HERMES_SESSION_CHAT_TYPE` em código. Fora da DM, devolvem só "converse comigo por mensagem direta", sem chamar o `ai-gateway`. Na DM o LLM recebe os dados normalmente, e a sessão já é isolada por usuário. A confirmação de escrita segue o S3: o código vai por DM separada e não volta ao LLM.
- **Gates adicionais da Etapa 3:**
  - Pedido de dados no canal é recusado sem chamada ao `ai-gateway`.
  - Na DM, o usuário só recebe dados conforme a RLS.
  - Conferir que quem tem o papel consegue falar com o bot por DM. O papel é do servidor e pode não valer em DM; se for preciso, usar `DISCORD_ALLOWED_USERS`.

## Modelo de acesso (RLS)

Helpers `security definer` (em `20261005000100_foundation.sql`) evitam recursão de RLS:
`current_user_role()`, `has_role()`, `is_admin()`, `is_internal()`, `is_project_manager(pid)`, `is_project_member(pid)`, `can_create_in_project(pid)`, `can_see_task(tid)`, `can_edit_task(tid)`.

| Perfil | Projetos | Tarefas | Clientes |
|---|---|---|---|
| `admin` | Todos | Total | Total |
| `gerente` | Cria; gerencia os seus; vê onde é membro | Total nos seus projetos | Cria/edita |
| `lider` | Onde é membro | Cria/edita qualquer uma do projeto | Leitura |
| `consultor` | Onde é membro | Cria; edita as atribuídas a si | Leitura |
| `externo` | Somente onde foi incluído | Somente atribuídas ou compartilhadas; sem comentários internos | Sem acesso |

A tabela acima é o **padrão de fábrica**. Desde `20261109120000_role_permissions.sql`, parte dela é configurável em Configurações → Perfis e permissões. Essa parte fica na tabela `role_permissions` (perfil × capacidade), e as policies a consultam via `role_can(perm)`.

**Capacidades configuráveis:**
- `project.create`
- `scope.manage`
- `task.create` (cobre tarefas e relatórios)
- `task.edit_any`
- `task.delete`
- `clients.view`
- `clients.manage`
- `knowledge.manage`

As capacidades de projeto valem nos projetos de que o usuário é membro.

**Regras fixas:**
- `admin` sempre tem tudo, e `externo` nunca recebe capacidade. Um trigger bloqueia a edição dessas duas linhas, e as policies de clientes exigem também `is_internal()`.
- O gestor do projeto (`manager_id`) tem tudo no próprio projeto.
- A visibilidade de projetos e tarefas, os comentários internos e Configurações não passam por `role_can`.

Toda alteração entra no `activity_log`.

Pontos de atenção:
- `profiles`: usuários só editam `name`/`job_title` (grant por coluna). Perfil/ativação: `admin_update_profile()`.
- `notifications`: usuário só altera `read`; criação por triggers (`notify_task_assigned`, `notify_comment`) e, futuramente, `pg_cron`.
- `ai_actions_log`: escrito pela Edge Function com `service_role`; usuário lê só o próprio, admin lê tudo.
- `activity_log`: trigger genérico (`log_activity`) em projects, tasks e project_members; sem policy de escrita.
- `reports`: imutável (sem UPDATE) e versionado por trigger; portfólio (`project_id is null`) só admin.
- Storage: caminho `{project_id}/{task_id}/{arquivo}`; a policy do objeto herda `can_see_task`.

## Limitações conhecidas (v1)
- Policies chamam funções por linha; suficiente para o volume interno esperado. Reavaliar com `explain analyze` se listas grandes ficarem lentas.
- Menções (`@`) e alertas de prazo (`due_soon`/`overdue`) ainda não geram notificações — Fase 3 (`pg_cron`).
- Sem varredura de malware nos anexos (validação nº 9 em aberto): anexos são sempre servidos como download.
- Tipos TypeScript estão em `types/domain.ts` à mão até o primeiro `npm run db:types`.
