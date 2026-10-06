# Roadmap e progresso

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente

## Fase 0 — Estrutura (este commit)
- ✅ Repositório, Next.js 16 + Tailwind + shadcn/ui, export estático
- ✅ Schema completo com RLS (fases 1–4) em `supabase/migrations`
- ✅ CI (lint, typecheck, build) e workflow de deploy FTP para KingHost
- ⬜ Conectar projeto Supabase (`supabase link`) e aplicar migrações
- ⬜ Criar o primeiro admin; configurar Auth (URL do site, e-mail)
- ⬜ Testes de RLS (pgTAP) e testes de front (Vitest) — exigidos por RNF-08

## Fase 1 — Fundação (RF-01, 20, 21)
- ✅ Login, AppShell, painel, clientes, projetos (lista/criação), detalhe básico
- ⬜ Tela de membros do projeto + convite de externos (depende da validação nº 8)
- ⬜ Administração de usuários (admin: ativar, definir perfil)
- ⬜ Provedor de login corporativo (validação nº 7)

## Fase 2 — Execução (RF-02, 06–11)
Categorias, tarefas (CRUD), checklist, anexos (URL assinada), comentários, Kanban com Realtime.

## Fase 3 — Cronograma e notificações (RF-12, 17–19)
Gantt (decidir dependências — validação nº 11), central de notificações, `pg_cron` para prazo próximo/vencido, menções.

## Fase 4 — IA (RF-03–05, 13–16)
`ai-gateway` (Edge Function), ferramentas restritas, auditoria, relatórios HTML (One Page/status). Depende das validações 1–5 e 10.

## Fase 5 — Indicadores (RF-23–26)
Views `security_invoker`, painéis Recharts, filtros, exportação HTML. Depende da validação nº 6.

## Validações em aberto que bloqueiam trabalho
Ver seção 12 de `REQUISITOS.md`. Próximas a destravar: **#7** (provedor de login) e **#8** (convite de externos) para fechar a Fase 1.
