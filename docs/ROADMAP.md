# Roadmap e progresso

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente

## Fase 0 — Estrutura
- ✅ Repositório, Next.js 16 + Tailwind + shadcn/ui, export estático
- ✅ Schema completo com RLS (fases 1–4) aplicado no Supabase (projeto `jipaumhvkldxnmwfdmji`) e versionado em `supabase/migrations`
- ✅ Advisors de segurança/performance tratados (restam apenas avisos esperados: helpers de RLS executáveis por `authenticated`)
- ✅ Teste de fumaça de RLS executado no banco (gerente/consultor/externo/não-membro/anon)
- ✅ CI (lint, typecheck, build) e workflow de deploy (Supabase + KingHost)
- ✅ Publicado na KingHost em https://prisma.ambienteconsulta.com.br (deploy via GitHub Actions)
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
- ✅ Alertas de prazo também por e-mail (Resend): resumo por pessoa às 08:05, Edge Function `deadline-emails` chamada pelo `pg_cron`; liga/desliga em Parâmetros
- ⬜ Menções (@) em comentários
- ⬜ Arrastar barras do Gantt para alterar datas

## Módulo de Configurações (admin) ✅
- ✅ `/configuracoes/` com 4 abas: **Parâmetros**, **Usuários**, **Perfis e permissões**, **Auditoria**
- ✅ Parâmetros (tabela `app_settings`, validados no banco, alteração auditada): nome da organização, antecedência do alerta de prazo, liga/desliga alertas de prazo próximo e vencido, escopos padrão de novos projetos. Fixos por requisito (somente exibidos): anexo 20 MB, fuso, senha mínima
- ✅ Usuários: busca e filtros, e-mail e último acesso, criar, editar nome/cargo, perfil, ativar/desativar, redefinir senha; o sistema nunca fica sem admin ativo
- ✅ "Esqueci a senha" no login: link por e-mail (Supabase Auth com SMTP do Resend) e tela `/redefinir-senha/`
- ⬜ Convite por e-mail na criação de usuário e "redefinir senha" do admin por link (hoje o admin define a senha)
- ✅ Matriz de perfis e permissões (somente leitura, espelha o RLS)
- ✅ Auditoria: trilha de `activity_log` (projetos, tarefas, membros, parâmetros) com filtro
- ⬜ Parâmetros futuros conforme as fases 4–5 (IA, metas de indicadores)

## Fase 4 — IA (RF-03–05, 13–16)
- ⬜ Etapa 0 — Preparação
- ⬜ Etapa 1 — VPS e Hermes
- ⬜ Etapa 2 — Login com Discord
- ⬜ Etapa 3 — Gateway de leitura
- ⬜ Etapa 4 — Canal por projeto e rotina diária
- ⬜ Etapa 5 — Escrita com confirmação
- ⬜ Etapa 6 — Áudio
- ⬜ Trilha paralela — Migração das chaves de API

## Fase 5 — Indicadores (RF-23–26)
Views `security_invoker`, painéis Recharts, filtros, exportação HTML. Depende da validação nº 6.

## Validações em aberto
Ver seção 12 de `REQUISITOS.md`. Resolvidas: **#7** (login por usuário/senha próprio). Próximas: #8 (como externos são cadastrados — hoje, um admin cria a conta), #11 (dependências no Gantt).
