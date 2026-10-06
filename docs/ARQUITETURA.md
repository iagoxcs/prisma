# Arquitetura — Prisma

Complementa `REQUISITOS.md` (v1.0). Aqui ficam as decisões de implementação tomadas ao estruturar o projeto.

## Mudanças em relação ao levantamento

| Tema | Levantamento | Implementado | Motivo |
|---|---|---|---|
| Hospedagem | Vercel / Cloudflare Pages | **Netlify (site estático)** | KingHost tentada em 06/10/2026, sem site/DNS disponível; ver `DEPLOY.md` |
| Next.js | App Router com SSR possível | **Export estático** (`output: "export"`) | Hospedagem só de arquivos estáticos (sem Node) |
| Rotas dinâmicas | `[id]` | Query string (`/projeto/?id=`) | Limitação do export estático |
| Cliente Supabase | server + browser | Somente browser | Sem servidor Next |
| Colunas | Misto PT/EN | Inglês (`title`, `name`, `body`…) | Consistência no código; UI continua em pt-BR |
| Compartilhar tarefa com externo | Citado em RF/matriz, sem tabela | Tabela `task_shares` | Necessária para "atribuídas ou compartilhadas" |
| `profiles.is_external` | Coluna | Coluna **gerada** a partir de `role = 'externo'` | Impede inconsistência perfil × flag |
| Novo usuário | — | Nasce `active = false`, `role = externo` | Menor privilégio; admin libera |

## Camadas

```
Navegador (site estático no Netlify)
   │ supabase-js (JWT do usuário)           │ chamadas à IA (Fase 4)
   ▼                                        ▼
Supabase: Auth · Postgres (RLS) · Storage · Realtime      Edge Function ai-gateway
                                                           (repassa o JWT; ferramentas restritas)
```

Toda autorização está no banco. O `AppShell` redireciona para `/login/` apenas por UX.

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
