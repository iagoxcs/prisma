# Prisma — Roadmap de melhorias

Backlog validado por Iago em 17/11/2026. Este arquivo é a fonte da verdade do andamento: o Claude Code o atualiza a cada PR (protocolo na seção 5).

Legenda: ✅ feito · 🟡 parcial · ⬜ pendente · ⛔ aguarda decisão (seção 4)

## 1. Backlog aprovado

| Ordem | Onda | ID | Item | Escopo e aceite mínimo | Depende de | Status | PRs |
|---|---|---|---|---|---|---|---|
| 1 | 1 | D1 | Registrar decisões de 14/11/2026 | Validações #1, #8 e #10 em REQUISITOS §12; matriz do externo em §7 | — | ✅ | #55 |
| 2 | 1 | E1 | Testes de banco e front no CI | Job db roda supabase/verify; Vitest em lib/; npm test no CI e no deploy | — | ✅ | #55 |
| 3 | 1 | E2 | Ambiente de homologação | Projeto prisma-hml; deploy-homolog.yml; URL das funções no Vault por ambiente; hml sem ai-gateway | — | ✅ | #55, #56 |
| 4 | 1 | A6 | Bloquear troca de projeto da tarefa | Trigger before update of project_id em tasks: sem public.is_admin() → erro 42501 "Não é possível mover a tarefa para outro projeto."; vale também para service_role; verify: consultor responsável recebe 42501, admin consegue, troca de status pelo responsável continua | — | ✅ | #57 |
| 5 | 1 | E3 | Concluir migração de chaves (DV8) | Passo 2 feito. Passo 3: só após 7 dias sem log de fallback para chave legada nas Edge Functions; remover o fallback de admin-users, deadline-emails e ai-gateway; DEPLOY.md com a revogação (desativar legadas e revogar a HS256 no painel, feito por Iago) | — | 🟡 (código sem retorno às legadas; falta desativar e revogar no painel) | #51, #52, #65 |
| 6 | 2 | F3 | Ata ou transcrição viram tarefas em lote | Escrita em lote no ai-gateway: até 30 tarefas numa única prévia, confirmada uma vez com ✅; cada tarefa validada como create_task; uma linha em ai_actions_log por tarefa; plugin do Hermes extrai "Saídas e Responsáveis" da ata e propõe o lote | — | ✅ | #58, #59, #60, #61 |
| 7 | 2 | I1 | Mais de um projeto no mesmo canal do Discord | O ID do canal continua digitado no editor do projeto. Fatias: (a) schema: sai o unique de projects.discord_channel_id e o unique de project_context_entries.source_ref passa a ser por projeto (project_id, source_ref); (b) ai-gateway: gravação do resumo da rotina idempotente por projeto e canal, sem o conflito source_ref_conflict entre projetos do mesmo canal; (c) rotina: lê cada canal uma vez, gera um único resumo e grava o mesmo resumo no Contexto de cada projeto vinculado; o alerta de canal sem projeto continua; (d) front: o editor do projeto aceita um canal já usado por outro projeto e mostra quais projetos dividem o canal | — | 🟡 (b, a, c) | #80, #81, #82 |
| 8 | 2 | O3 | Prévias da IA resistentes a reinício | Guardar canal e message_id da prévia em ai_pending_actions; ao iniciar, o plugin retoma a observação das prévias em status proposed ainda não expiradas | — | ✅ | #62, #63, #64 |
| 9 | 2 | O5 | Telemetria de custo da IA | A rotina consulta o relatório de uso do router de LLM da Hostinger (bot, transcrição e resumo diário) e publica o total do mês no #prisma-operacao. Se o router não tiver API de uso, parar e perguntar antes de seguir | — | ⬜ | |
| 10 | 2 | O1 | Teste repetível das aprovações de escrita da IA | Script contra a stack local (supabase start + supabase functions serve ai-gateway), porque a hml não tem ai-gateway: código errado 2×, cancelamento na 3ª tentativa, reuso, prévia expirada, usuário diferente → recusados; prévia válida → executada | — | ⬜ | |
| 11 | 2 | E5 | Deploy do Hermes reproduzível | hermes/deploy/: config.yaml de referência sem segredos + install.sh idempotente (plugin, rotina, timer do systemd) para a VPS atual; hermes/README.md atualizado | — | ⬜ | |
| 12 | 3 | F2 | One Page e status report | Fatias: (a) reports.task_id; (b) Edge Function de geração em HTML na identidade do Prisma (tokens do tema Lâminas, superfícies sólidas, sem backdrop-filter); (c) aba Relatórios no projeto e na tarefa, com versões e iframe sandbox; (d) generate_report no ai-gateway. Sem bloco de saúde do projeto | — | ⬜ | |
| 13 | 3 | F5 | Criar projeto a partir de modelo | Na criação do projeto, escolher um modelo (knowledge_items de metodologia com template_csv); RPC atômica cria escopos e tarefas com datas relativas ao início | — | ⬜ | |
| 14 | 3 | F7 | Acesso de clientes (externos) | (a) convite por e-mail feito só pelo admin, com papel externo; (b) interface de task_shares; (c) externo altera só o status das tarefas atribuídas a ele e marca itens existentes do checklist; compartilhadas só leitura; não cria nem exclui tarefas ou itens; (d) gerente do projeto inclui externo já cadastrado | A6 | ⬜ | |
| 15 | 3 | F8 | Menções (@) em comentários | Seletor de membros do projeto ao digitar @; notificação mention ao mencionado; só membros que veem a tarefa | — | ⬜ | |
| 16 | 3 | I3 | Edição direta na Lista | Status, responsável e prazo editáveis na linha da aba Lista, respeitando RLS e Realtime | — | ⬜ | |
| 17 | 3 | O4 | Lembrete de tarefas sem prazo | Notificação + e-mail nos dias 1 e 15, às 08:00, ao gerente do projeto | — | ✅ | #55 |
| 18 | 4 | O2 | Busca híbrida (texto + pgvector) | Trechos com embedding para project_context_entries e knowledge_items; search_context e search_knowledge com busca híbrida sob RLS | Volume de contexto | ⬜ | |
| 19 | 4 | O6 | Arrastar barras do Gantt | Mover e redimensionar barras altera start_date e due_date, respeitando RLS | — | ⬜ | |
| 20 | 4 | I6 | Estados vazios que orientam | Contexto vazio → "Importar ata"; Conhecimento vazio → "Publicar metodologia" | — | ⬜ | |
| 21 | 4 | E6 | Arquivar projetos concluídos | Arquivados fora das listas, do Realtime e da rotina diária, com filtro "Mostrar arquivados" | — | ⬜ | |
| 22 | 5 | P1 | Login, Meu painel, menu e exclusões | Login sem passar por "Acesso pendente" (sessão e perfil trocam juntos; falha ao ler o perfil mostra erro com nova tentativa); seções do Meu painel recolhíveis; menu lateral recolhível (só ícones); admin exclui projeto (digitando o nome; anexos saem do Storage) e cliente (bloqueado se houver projetos) | — | ✅ | #66 |
| 23 | 5 | P2 | Tarefa cancelada (schema) | task_status ganha cancelled; cancelada fica fora de prazos, avisos, e-mails, atraso, lembrete sem prazo e do total dos indicadores | — | ✅ | #67 |
| 24 | 5 | P3 | Tarefa cancelada (front) | Status "Cancelada" no painel da tarefa; fora do Quadro e do Cronograma; na Lista só pelo filtro "Canceladas" | P2 | ✅ | #68 |
| 25 | 5 | P4 | Excluir usuário (função) | admin-users ganha a ação delete; recusa o próprio usuário e o último admin ativo | — | ✅ | #69 |
| 26 | 5 | P5 | Excluir usuário (front) | Botão Excluir em Configurações > Usuários, com confirmação | P4 | ✅ | #70 |
| 27 | 5 | P6 | Lista de tarefas pelo Discord numa prévia só | Plugin 0.7.0: prisma_criar_tarefas_lote vale para qualquer lista (texto, planilha, arquivo, ata); duas ou mais tarefas nunca viram prévias separadas | — | ✅ | #71, #72, #74 |
| 28 | 6 | P7 | Salvamento automático | Detalhes da tarefa (painel), tarefa pessoal (Meu painel) e editor do projeto gravam sozinhos após 1 s de pausa, ao sair do formulário, com Enter e ao fechar; tarefa e projeto enviam só os campos alterados; indicador Salvando…/Salvo/erro; título vazio ou dado inválido não grava e, ao fechar, pede para descartar | — | ✅ | #77 |
| 29 | 6 | P8 | Cliente na edição do projeto | Editar projeto ganha o campo Cliente (ativos, mais o atual se inativo); quem tem clients.manage cria um cliente novo ali mesmo e já o vincula | — | ✅ | #77 |
| 30 | 6 | P9 | Enquadramento por dispositivo | Nada cortado em celular (375 px), tablet e notebook com janela baixa (≥ 600 px de altura): menu lateral compacta em janela baixa e rola com barra visível; celular com navegação em linha própria e página atual sempre visível (inclusive em /projeto/); abas do projeto quebram linha; Indicadores sem rolagem lateral (tabela sr-only dos gráficos); notificações dentro da tela; diálogos com altura máxima e rolagem | — | ✅ | #78 |

## 2. Reprovados (não implementar)

F1 Saúde do projeto · F4 Encerramento com lições aprendidas · F6 Briefing semanal da IA · I2 Paleta de comandos e atalhos · I4 Criação rápida em texto · I5 Atividade da IA no projeto · E4 Painel de operação da IA · qualquer mensuração de horas (apontamento, estimativa, capacidade)

## 3. Decisões registradas

| Data | Tema | Decisão |
|---|---|---|
| 14/11/2026 | Relatórios | Ação = tarefa; relatórios por projeto e por tarefa, na identidade visual do Prisma |
| 14/11/2026 | Hermes | Continua na VPS atual |
| 14/11/2026 | Horas | Fora do escopo |
| 17/11/2026 | Externos | Só o admin cria a conta; gerente inclui externo já cadastrado; externo altera só o status das atribuídas e marca itens existentes do checklist; compartilhadas só leitura |
| 17/11/2026 | O4 | Notificação + e-mail quinzenal ao gerente do projeto |
| 17/11/2026 | Homologação | MCP com execute_sql só para dados de teste na hml, sem DDL; e-mail de prazo desligado na hml |
| 19/11/2026 | Onda 5 (pedido de Iago) | Cancelada não conta como aberta nem no total dos indicadores; aparece só em Lista > Canceladas. Exclusão de projeto, cliente e usuário só para admin; usuário não exclui a si mesmo nem o último admin ativo |
| 20/11/2026 | Onda 6 (pedido de Iago) | Formulários de tarefa e de projeto sem botão Salvar: salvamento automático. Cliente pode ser incluído ou trocado depois de criado o projeto |
| 21/11/2026 | DP1 (I1) | O ID do canal continua digitado no projeto, como hoje. Um canal pode ter mais de um projeto; a rotina grava o mesmo resumo do canal no Contexto de cada projeto vinculado |
| 21/11/2026 | DP2 (O5) | O custo vem do relatório de uso do provedor de LLM (router da Hostinger), consultado pela rotina |

## 4. Decisões pendentes

Nenhuma.

## 5. Protocolo de execução

1. **Próximo item:** o primeiro da coluna Ordem com status ⬜ ou 🟡, cujas dependências estão ✅ e sem decisão pendente. Item ⛔ só avança com a decisão registrada na seção 4 e movida para a seção 3.
2. **Plano:** em plan mode, dividir o item em fatias de uma sessão cada, sem misturar schema, Edge Function e front na mesma fatia. Para cada fatia: arquivos exatos, aceite verificável e comando de validação. Aguardar aprovação.
3. **Execução:** uma fatia por sessão, em uma branch `feat/<id>-<slug>`. Validação: npm run lint && npm run typecheck && npm test && npm run build; com migração, também supabase db reset && npm run db:verify. Fatia com migração ou Edge Function passa por push na branch homolog antes da PR para main.
4. **Registro:** na mesma branch, atualizar a linha do item (🟡 com a fatia concluída entre parênteses, ✅ quando todas estiverem concluídas) e a coluna PRs.
5. **Regras:** CLAUDE.md prevalece. Item reprovado não é implementado. Conflito com as premissas ou lacuna de requisito: parar e perguntar.
