# Gerenciador de Projetos — Requisitos e Arquitetura

**Cliente interno:** Ambiente Consultoria
**Natureza:** ferramenta interna, single-tenant
**Desenvolvimento:** Claude Code + Supabase, publicação em domínio próprio
**Status:** versão 1.0 — sujeita às validações da seção 12

---

## 1. Visão geral

Módulo de gestão de projetos integrado a um sistema interno da Ambiente, com três objetivos:

1. Gerenciar projetos, escopos e tarefas.
2. Centralizar dados e gerar relatórios e indicadores dentro da própria ferramenta.
3. Conectar um agente de IA à base de conhecimento e aos dados dos projetos.

Premissas de arquitetura:

- **Single-tenant:** uma instância, uma organização. Não há `tenant_id` nem modelo multi-organização.
- **Sem Lovable:** o front-end é desenvolvido com Claude Code.
- **Sem Power BI:** os indicadores são construídos e exibidos dentro da ferramenta.

---

## 2. Stack tecnológica

| Camada | Tecnologia | Observação |
|---|---|---|
| Front-end | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | Desenvolvido via Claude Code |
| Gráficos | Recharts (indicadores) + biblioteca de Gantt (a definir na Fase 3) | Renderização no cliente |
| Autenticação | Supabase Auth | Login corporativo para internos; convite por e-mail para externos |
| Banco de dados | Supabase Postgres | RLS em todas as tabelas, views, triggers |
| Lógica privilegiada | Supabase Edge Functions | Gateway da IA, geração de relatórios, notificações |
| Jobs agendados | `pg_cron` | Alertas de prazo e atualização de indicadores |
| Arquivos | Supabase Storage | Bucket privado, limite de 20 MB por arquivo |
| Tempo real | Supabase Realtime | Kanban, comentários e notificações |
| Agente de IA | Agente Hermes + LLM (GPT ou Claude) | Integração via gateway controlado (seção 8) |
| Hospedagem | Vercel ou Cloudflare Pages + domínio próprio | Deploy via GitHub |

### Decisões de revisão

| Item | Antes | Agora | Motivo |
|---|---|---|---|
| Front-end | Lovable | Next.js via Claude Code | Decisão do projeto |
| BI / indicadores | Power BI | Módulo de indicadores interno | Decisão do projeto |
| Acesso da IA ao Supabase | "Acesso total" | Acesso sob as permissões do usuário que aciona (RLS) | Evita vazamento entre projetos e para terceiros (seção 8) |

---

## 3. Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│  Navegador (Next.js)                                    │
│  Projetos · Kanban · Gantt · Notificações · Indicadores │
└───────────────┬─────────────────────────┬───────────────┘
                │ supabase-js (JWT)       │ chamadas à IA
                ▼                         ▼
┌───────────────────────────┐   ┌─────────────────────────┐
│ Supabase                  │   │ Edge Function           │
│  Auth · Postgres (RLS)    │◄──│ ai-gateway              │
│  Storage · Realtime       │   │  (repassa JWT do        │
│  pg_cron · Views          │   │   usuário, ferramentas  │
└───────────────────────────┘   │   restritas, auditoria) │
                                └───────────┬─────────────┘
                                            ▼
                                  Agente Hermes → LLM
```

Princípios:

- **Segurança no banco:** toda regra de acesso vive em RLS, não no front-end.
- **Mutações da IA com a identidade do usuário:** o gateway repassa o JWT de quem acionou, então a IA nunca enxerga ou altera mais do que o próprio usuário.
- **Migrações versionadas:** nenhuma alteração de schema direto no painel do Supabase.
- **Ambientes separados:** projetos Supabase distintos para dev e prod.

---

## 4. Requisitos funcionais

### 4.1 Projetos e escopos

| ID | Requisito |
|---|---|
| RF-01 | Cadastro de projetos (nome, cliente, gerente, período, status). |
| RF-02 | Cada projeto suporta múltiplos escopos, implementados como **categorias** das tarefas. |
| RF-03 | Geração de **One Page** e **status report** em HTML por projeto e por ação. |
| RF-04 | A IA auxilia na geração e consolidação dos relatórios. |
| RF-05 | Relatórios gerados ficam armazenados e versionados. |

### 4.2 Tarefas

| ID | Requisito |
|---|---|
| RF-06 | Campos: título, descrição, responsável, prazo, categoria. |
| RF-07 | Responsável pode ser membro da equipe ou terceiro. |
| RF-08 | Checklist interno com itens marcáveis. |
| RF-09 | Anexos de qualquer formato, até **20 MB por arquivo**. |
| RF-10 | Comentários com histórico (autor e data). |
| RF-11 | Visualização **Kanban** com colunas *A Fazer*, *Fazendo* e *Feito*. |
| RF-12 | Visualização em **Gantt** para tarefas e projetos. |

> O Gantt exige data de início além do prazo. O campo `start_date` é adicionado ao modelo (seção 6).

### 4.3 Agente de IA

| ID | Requisito |
|---|---|
| RF-13 | Todos os colaboradores da organização têm acesso à IA. |
| RF-14 | A IA cria e atualiza tarefas por comando. |
| RF-15 | A IA consulta a base de conhecimento da empresa e os dados dos projetos para apoiar decisões e relatórios. |
| RF-16 | Toda ação de escrita feita pela IA é registrada em log de auditoria. |

### 4.4 Notificações

| ID | Requisito |
|---|---|
| RF-17 | Central de notificações in-app, com cada usuário vendo apenas as suas. |
| RF-18 | Gatilhos: tarefa atribuída, prazo próximo, prazo vencido, novo comentário, menção. |
| RF-19 | Marcação de lida/não lida e contador no cabeçalho. |

### 4.5 Controle de acessos

| ID | Requisito |
|---|---|
| RF-20 | Perfis de usuário com permissões diferenciadas. |
| RF-21 | Terceiros acessam apenas os projetos e tarefas para os quais forem explicitamente incluídos. |
| RF-22 | Terceiros não visualizam dados internos (indicadores consolidados, outros projetos, comentários internos). |

### 4.6 Indicadores (substitui Power BI)

| ID | Requisito |
|---|---|
| RF-23 | Relatório de indicadores dentro da ferramenta, em nível de portfólio e de projeto. |
| RF-24 | Filtros por período, projeto, categoria (escopo) e responsável. |
| RF-25 | Indicadores respeitam o perfil de acesso de quem consulta. |
| RF-26 | Exportação do relatório de indicadores em HTML, no mesmo padrão dos status reports. |

---

## 5. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-01 | RLS habilitado em 100% das tabelas desde a primeira migração. |
| RNF-02 | `service_role` nunca exposta ao navegador; uso restrito a Edge Functions. |
| RNF-03 | Bucket de anexos privado, acesso por URL assinada, limite de 20 MB aplicado no bucket e na interface. |
| RNF-04 | Anexos de qualquer formato são sempre servidos como download, nunca executados ou renderizados inline. |
| RNF-05 | HTML de relatórios renderizado em iframe com `sandbox`, sem script. |
| RNF-06 | Backups habilitados no projeto de produção. |
| RNF-07 | Tipos TypeScript gerados a partir do schema a cada migração. |
| RNF-08 | CI com lint, typecheck e testes antes de qualquer deploy. |

---

## 6. Modelo de dados

| Tabela | Campos-chave | Atende |
|---|---|---|
| `profiles` | id (FK `auth.users`), nome, cargo, `role`, `is_external`, ativo | RF-20 |
| `clients` | id, nome, status | RF-01 |
| `projects` | id, client_id, nome, status, gerente_id, início, fim | RF-01 |
| `project_members` | project_id, user_id, papel no projeto | RF-21 |
| `categories` | id, project_id, nome, cor | RF-02 |
| `tasks` | id, project_id, category_id, título, descrição, `status` (`todo` / `doing` / `done`), assignee_id, `start_date`, `due_date`, concluded_at, position | RF-06, 11, 12 |
| `checklist_items` | id, task_id, texto, concluído, ordem | RF-08 |
| `task_attachments` | id, task_id, storage_path, nome, tamanho, mime, uploaded_by | RF-09 |
| `comments` | id, task_id, author_id, corpo, `is_internal` | RF-10, 22 |
| `notifications` | id, user_id, tipo, entidade, entidade_id, lida, criada_em | RF-17 a 19 |
| `reports` | id, project_id, tipo (`one_page` / `status` / `indicadores`), versão, html, gerado_por, `generated_by_ai` | RF-03 a 05, 26 |
| `ai_actions_log` | id, user_id, ferramenta, entrada, resultado, timestamp | RF-16 |
| `activity_log` | id, entidade, ação, user_id, diff (jsonb), timestamp | Rastreabilidade |

Observações:

- `comments.is_internal` permite que comentários internos fiquem ocultos para terceiros.
- Mudança de `status` para `done` preenche `concluded_at` via trigger; esse campo alimenta os indicadores de lead time e throughput.

---

## 7. Perfis e permissões

> Matriz proposta, sujeita à validação da seção 12.

| Perfil | Projetos | Tarefas | Indicadores | Administração de usuários | IA |
|---|---|---|---|---|---|
| `admin` | Todos | Total | Portfólio completo | Sim | Sim |
| `gerente` | Os que gerencia ou participa | Total nos seus projetos | Seus projetos | Não | Sim |
| `lider` | Os que participa | Criar e editar nos seus projetos | Seus projetos | Não | Sim |
| `consultor` | Os que participa | Editar as atribuídas a si; criar | Seus projetos | Não | Sim |
| `externo` | Apenas os convidados | Apenas as atribuídas ou compartilhadas | Não | Não | A validar |

Implementação em RLS:

- Função `is_project_member(project_id)` reutilizada nas policies de `tasks`, `comments`, `attachments`, `checklist_items` e `reports`.
- Função `has_role(role)` para regras por perfil.
- Policies de `externo` excluem comentários internos e qualquer tabela de consolidação.
- `notifications`: `user_id = auth.uid()` em todas as operações.
- Políticas de Storage replicam a regra de acesso da tarefa dona do anexo.

---

## 8. Integração com o agente de IA

### 8.1 Modelo de acesso

O requisito original prevê acesso total da IA ao Supabase, com todos os colaboradores podendo acioná-la. Combinados, isso permite que qualquer usuário, inclusive um de acesso restrito, obtenha via IA dados de projetos aos quais não tem acesso.

Modelo adotado:

| Aspecto | Definição |
|---|---|
| Identidade | A IA opera com o JWT do usuário que a acionou; o RLS se aplica normalmente. |
| Ponto de entrada | Edge Function `ai-gateway`, única porta entre o agente e o banco. |
| Ferramentas expostas | `list_projects`, `list_tasks`, `get_task`, `create_task`, `update_task`, `add_comment`, `generate_report`. |
| Exclusões | Sem SQL arbitrário, sem exclusão de dados, sem alteração de perfis e permissões. |
| Auditoria | Cada chamada de escrita gera registro em `ai_actions_log`. |
| Confirmação | Criação e atualização em lote exigem confirmação do usuário na interface antes de gravar. |

### 8.2 Base de conhecimento

O local e o formato da base de conhecimento ainda não estão definidos (seção 12). A arquitetura prevê duas alternativas:

- **Dentro do Supabase:** tabela de documentos com `pgvector` para busca semântica.
- **Externa:** repositório mantido pelo próprio agente, consultado por ele.

---

## 9. Módulo de indicadores

### 9.1 Implementação

- **Views SQL com `security_invoker = true`**, de forma que o RLS do usuário consultante se aplique às agregações.
- Materialização apenas se houver problema de desempenho, com acesso restrito por função, já que views materializadas não herdam RLS.
- Atualização por `pg_cron` quando houver materialização.
- Visualização com Recharts, filtros no cliente e consulta via Supabase.
- Exportação em HTML armazenada na tabela `reports` (tipo `indicadores`).

### 9.2 Indicadores candidatos

> Proposta derivada dos campos já previstos no modelo. O conjunto final depende de validação.

| Indicador | Definição | Nível |
|---|---|---|
| Conclusão | Tarefas `done` ÷ total de tarefas | Projeto, portfólio |
| Atrasadas | Tarefas não concluídas com `due_date` vencido | Projeto, responsável |
| Aderência ao prazo | Tarefas concluídas até o prazo ÷ concluídas | Projeto, responsável |
| Throughput | Tarefas concluídas por semana | Projeto, portfólio |
| Lead time | Média de dias entre criação e `concluded_at` | Projeto, categoria |
| Carga por responsável | Tarefas abertas por pessoa | Portfólio |
| Distribuição por escopo | Tarefas por categoria e status | Projeto |
| Uso da IA | Ações de escrita da IA por período | Portfólio (admin) |

Indicadores de custo, horas e risco **não** fazem parte do escopo atual, pois o modelo não prevê esses dados.

---

## 10. Estrutura do repositório e fluxo de desenvolvimento

```
/app                    rotas Next.js
/components             UI reutilizável
/lib/supabase           clients server e browser
/supabase
  /migrations           SQL versionado
  /functions            Edge Functions (ai-gateway, reports, notifications)
  seed.sql
/types/database.ts      gerado via `supabase gen types`
CLAUDE.md               regras do projeto para o Claude Code
```

Fluxo com Claude Code:

1. **`CLAUDE.md`** com stack, convenções, regra "toda tabela nova nasce com RLS", uso do termo "Líderes" na interface e comandos de build/teste.
2. **Migrações via Supabase CLI** (`supabase migration new`).
3. **Supabase MCP** conectado apenas ao projeto dev, preferencialmente em modo somente leitura.
4. **Plan mode** para schema, permissões e gateway da IA, com implementação após aprovação do plano.
5. **Tipos regenerados** a cada migração.
6. **CI no GitHub Actions** com lint, typecheck e testes antes do deploy.

---

## 11. Roadmap

| Fase | Escopo | Requisitos |
|---|---|---|
| 1. Fundação | Auth, perfis, clientes, projetos, membros, RLS, deploy no domínio | RF-01, 20, 21 |
| 2. Execução | Tarefas, categorias, checklist, anexos, comentários, Kanban | RF-02, 06 a 11 |
| 3. Cronograma e notificações | Gantt, central de notificações, gatilhos por `pg_cron` | RF-12, 17 a 19 |
| 4. IA | `ai-gateway`, ferramentas, auditoria, geração assistida de relatórios | RF-03 a 05, 13 a 16 |
| 5. Indicadores | Views, painéis, filtros, exportação HTML | RF-23 a 26 |

---

## 12. Validações em aberto

| # | Pergunta | Impacto |
|---|---|---|
| 1 | O que é uma "ação" nos relatórios (RF-03)? É uma tarefa, um grupo de tarefas ou uma entidade própria? | Modelo de dados e geração de relatórios |
| 2 | A IA deve respeitar as permissões de cada usuário (modelo da seção 8) ou ter acesso total conforme o requisito original? | Segurança e arquitetura do gateway |
| 3 | Terceiros (`externo`) podem acionar a IA? | Matriz de permissões |
| 4 | Onde fica a base de conhecimento e qual o volume e formato dos documentos? | Pgvector vs. repositório externo |
| 5 | Como o agente Hermes é hospedado e quem o opera? | Autenticação e contrato do gateway |
| 6 | Quais indicadores da seção 9.2 entram na v1 e há outros necessários? Há metas por indicador? | Views e painéis |
| 7 | Provedor de login dos internos: Google Workspace ou Microsoft 365? | Configuração do Auth |
| 8 | Como terceiros são convidados e quem os aprova? | Fluxo de onboarding externo |
| 9 | Anexos de qualquer formato exigem varredura de malware? | Pipeline de upload |
| 10 | Os relatórios HTML precisam seguir um padrão visual já existente da Ambiente? | Templates de relatório |
| 11 | Gantt precisa de dependências entre tarefas ou apenas barras por período? | Modelo (`task_dependencies`) e Fase 3 |
| 12 | Quantos usuários internos e externos são esperados? | Dimensionamento do plano Supabase |
