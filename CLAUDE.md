@AGENTS.md

# Prisma — Gerenciador de Projetos (Ambiente Consultoria)

Ferramenta interna, **single-tenant** (sem `tenant_id`). Especificação completa: `docs/REQUISITOS.md`.
Decisões e arquitetura: `docs/ARQUITETURA.md`. Fases: `docs/ROADMAP.md`. Deploy: `docs/DEPLOY-KINGHOST.md`.

## Stack
Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Supabase (Auth, Postgres+RLS, Storage, Realtime, Edge Functions, pg_cron) · publicação **estática** na KingHost.

## Regras (inegociáveis)
- **Toda tabela nova nasce com `enable row level security` e policies na mesma migração.**
- **Site estático (`output: "export"`)**: sem SSR, sem API routes, sem middleware, sem Server Actions. Rotas dinâmicas usam query string (`/projeto/?id=`), nunca `[id]`. Páginas com `useSearchParams` ficam dentro de `<Suspense>`.
- Lógica privilegiada (IA, geração de relatórios, notificações agendadas) = Edge Function. `service_role` **nunca** no front nem em variável `NEXT_PUBLIC_*`.
- Schema só por migração (`supabase migration new`); nada no painel do Supabase. Regenerar tipos a cada migração (`npm run db:types`).
- Anexos: bucket privado, URL assinada, sempre download (nunca inline). HTML de relatório: `<iframe sandbox>` sem script.
- A IA opera com o JWT do usuário (RLS aplica); sem SQL arbitrário, sem exclusões; escrita registrada em `ai_actions_log`.
- Autorização vive no banco. Guardas no front (AppShell) são só UX.

## Convenções
- Interface em pt-BR; usar o termo **"Líderes"**. Colunas/identificadores em inglês (`title`, `due_date`, `assignee_id`).
- Papéis: `admin`, `gerente`, `lider`, `consultor`, `externo` (matriz em `docs/ARQUITETURA.md`).
- Datas/horas: `timestamptz` no banco; exibir em America/Sao_Paulo.
- Supabase MCP só no projeto **dev**, de preferência read-only. Plan mode para schema, permissões e ai-gateway.

## Comandos
```
npm run dev         # servidor local
npm run lint && npm run typecheck && npm run build   # o mesmo que o CI roda; build gera ./out
supabase start      # stack local (requer Docker)
supabase db reset   # reaplica migrações + seed
supabase migration new <nome>
npm run db:types
```
