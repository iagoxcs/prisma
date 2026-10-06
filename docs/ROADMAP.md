# Roadmap e progresso

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente

## Fase 0 — Estrutura
- ✅ Repositório, Next.js 16 + Tailwind + shadcn/ui, export estático
- ✅ Schema completo com RLS (fases 1–4) aplicado no Supabase (projeto `jipaumhvkldxnmwfdmji`) e versionado em `supabase/migrations`
- ✅ Advisors de segurança/performance tratados (restam apenas avisos esperados: helpers de RLS executáveis por `authenticated`)
- ✅ Teste de fumaça de RLS executado no banco (gerente/consultor/externo/não-membro/anon)
- ✅ CI (lint, typecheck, build) e workflow de deploy (Supabase + Netlify)
- ⬜ Criar o primeiro admin (ver `DEPLOY.md`)
- ⬜ Testes automatizados de RLS (pgTAP) e de front (Vitest) — exigidos por RNF-08
- ⬜ Separar projetos Supabase dev/prod (hoje há um só)

## Fase 1 — Fundação (RF-01, 20, 21) ✅
- ✅ Login por **usuário e senha** próprios (sem Google/Microsoft; sem cadastro aberto)
- ✅ Administração de usuários (criar, perfil, ativar/desativar, redefinir senha) via Edge Function `admin-users`
- ✅ Clientes, projetos, membros do projeto

## Fase 2 — Execução (RF-02, 06–11) ✅
- ✅ Escopos (categorias) por projeto
- ✅ Tarefas: título, descrição, responsável (equipe ou externo), prazo, início, escopo
- ✅ Checklist, comentários (com opção "interno"), anexos até 20 MB (download via URL assinada)
- ✅ Kanban A Fazer / Fazendo / Feito com arrastar e soltar, filtros e Realtime
- 🟡 Reordenação dentro da coluna (hoje o cartão movido vai para o fim)
- 🟡 Compartilhar tarefa com externo (tabela `task_shares` pronta; falta interface)

## Fase 3 — Cronograma e notificações (RF-12, 17–19) ✅
- ✅ Gantt por período (sem dependências — decisão da v1; reavaliar na validação nº 11): aba **Cronograma** em cada projeto e **Cronograma de projetos** (portfólio)
- ✅ Escala dia/semana/mês, linha de "hoje", cor por escopo, destaque de atrasadas; clicar abre a tarefa
- ✅ Edição de status e período do projeto (gerente/admin)
- ✅ Central de notificações: sino com contador em tempo real, lista rápida, página `/notificacoes/`, lida/não lida, excluir
- ✅ Gatilhos: atribuição, novo comentário, prazo próximo (hoje/amanhã) e prazo vencido via `pg_cron` diário às 08:00 de Brasília
- ⬜ Menções (@) em comentários
- ⬜ Arrastar barras do Gantt para alterar datas

## Módulo de Configurações (admin) ✅
- ✅ `/configuracoes/` com 4 abas: **Parâmetros**, **Usuários**, **Perfis e permissões**, **Auditoria**
- ✅ Parâmetros (tabela `app_settings`, validados no banco, alteração auditada): nome da organização, antecedência do alerta de prazo, liga/desliga alertas de prazo próximo e vencido, escopos padrão de novos projetos. Fixos por requisito (somente exibidos): anexo 20 MB, fuso, senha mínima
- ✅ Usuários: busca e filtros, e-mail e último acesso, criar, editar nome/cargo, perfil, ativar/desativar, redefinir senha; o sistema nunca fica sem admin ativo
- ✅ Matriz de perfis e permissões (somente leitura, espelha o RLS)
- ✅ Auditoria: trilha de `activity_log` (projetos, tarefas, membros, parâmetros) com filtro
- ⬜ Parâmetros futuros conforme as fases 4–5 (IA, metas de indicadores)

## Fase 4 — IA (RF-03–05, 13–16)
`ai-gateway`, ferramentas restritas, auditoria, relatórios HTML. Depende das validações 1–5 e 10.

## Fase 5 — Indicadores (RF-23–26)
Views `security_invoker`, painéis Recharts, filtros, exportação HTML. Depende da validação nº 6.

## Validações em aberto
Ver seção 12 de `REQUISITOS.md`. Resolvidas: **#7** (login por usuário/senha próprio). Próximas: #8 (como externos são cadastrados — hoje, um admin cria a conta), #11 (dependências no Gantt).
