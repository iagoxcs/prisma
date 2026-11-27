# Prisma · Especificação da página inicial e das rotas de entrada

**Data:** 27/11/2026 (revisão 2) · **Modo:** D (Requisitos) + B (Prompt para Claude Code) · **Protótipo validado:** `docs/prototipos/pagina-inicial.html`

Este arquivo é a fonte única para desenvolver a entrega. `CLAUDE.md` e `docs/IDENTIDADE-VISUAL.md` prevalecem em caso de conflito. Conflito com as premissas ou lacuna de requisito: parar e perguntar.

---

## 1. Objetivo

Criar uma página inicial pública em `https://prisma.ambienteconsulta.com.br/` que reúne funcionalidades, vídeos de uso (Prisma e Discord), ferramentas e links da Ambiente, fluxo de trabalho, boas práticas e suporte. O módulo Meu painel, hoje na raiz, passa para `/meu-painel/`.

**Resultado esperado:** um colaborador novo entende o que a ferramenta faz, assiste às pílulas e segue para o login, sem depender de apresentação à parte.

---

## 2. Decisões registradas (Iago, 27/11/2026)

| ID | Tema | Decisão |
|---|---|---|
| D1 | Rotas | `/` = página inicial. `/login/` = tela de login (permanece como está). `/meu-painel/` = módulo Meu painel (hoje em `/`). |
| D2 | Vídeos | Permanecem públicos, com o conteúdo atual. Risco de exposição de dados reais aceito. |
| D3 | Organograma | Removido da página. |
| D4 | Redmine | Removido da lista de ferramentas. |
| D5 | Discord | Link da ferramenta: `https://discord.com/app`. |
| D6 | Roadmap | Não há item no `ROADMAP-MELHORIAS.md`. O item é criado nesta entrega (ver seção 10). |
| D7 | Hospedagem dos vídeos | Arquivos comprimidos em `public/onboarding/videos/` (33 MB, 14 arquivos), servidos pela KingHost. Sem migração e sem Edge Function. |
| D8 | Assistente no canal | Textos da página seguem a DP6 do roadmap (24/11/2026): o @prisma responde no canal com os mesmos dados da DM. A página recomenda a DM para dados sensíveis (regra 1 do Discord, Boas práticas e dúvida frequente, seção 8). |

### Comportamento assumido (confirmar se discordar)

| ID | Ponto | Padrão adotado |
|---|---|---|
| P1 | Usuário com sessão ativa abre `/` | A página inicial é exibida normalmente, sem redirecionar. O botão principal muda de "Entrar" (`/login/`) para "Ir para o Meu painel" (`/meu-painel/`). Assim os vídeos seguem acessíveis a quem já está logado. |
| P2 | Destino após o login | `/meu-painel/` (antes `/`). |
| P3 | Marca no menu lateral do app | Continua levando ao Meu painel, agora em `/meu-painel/`. |
| P4 | Links já enviados por e-mail | Não mudam: apontam para `/notificacoes/` e `/projeto/`, que não são afetados. |

---

## 3. Achados

| ID | Severidade | Achado | Situação |
|---|---|---|---|
| A1 | Alto | Os vídeos mostram dados reais (nome de projeto de cliente e nome de usuário). Em `public/`, qualquer pessoa com o endereço assiste. | Risco aceito (D2). Recomendação mantida: regravar com dados fictícios em uma próxima versão. |
| A2 | Alto | Favoritos e atalhos da equipe para a raiz deixam de abrir o Meu painel. | Tratado por P1: a página inicial mostra "Ir para o Meu painel" a quem tem sessão. Comunicar a mudança à equipe. |
| A3 | Crítico (já tratado) | O material de origem das ferramentas trazia logins e senhas compartilhados. | Nenhuma credencial entra na página nem no repositório. Trocar as senhas expostas no material antigo. |
| A4 | Médio | A raiz hoje está dentro do grupo `(app)` e exige sessão. Mover a rota toca navegação, login e documentação. | Fatia própria (fatia 2), sem mudança de comportamento além do endereço. |
| A5 | Baixo | O link do Target Normas aponta para o site institucional e o do modelo de importação está indefinido. | Botão oculto quando `href` for nulo. Iago informa os endereços. |

---

## 4. Premissas e regras (não negociáveis)

- Single-tenant, export estático (`output: "export"`, `trailingSlash: true`), sem servidor Node. Nada de rota dinâmica, Server Action, API route ou `redirect()` de servidor. Redirecionamentos são feitos no cliente, como já ocorre no `AppShell` e no login.
- Dados e autenticação só pelo Supabase. Esta entrega não cria tabela, policy nem Edge Function, e não altera configuração de autenticação.
- Sem Lovable e sem Power BI.
- Identidade "Estratos": nenhum hex, `rgb()` ou cor nomeada do Tailwind em componentes; só classes dos tokens.
- Camadas de vidro: no máximo três superfícies com blur visíveis; nunca aninhar `backdrop-filter`; item repetido usa `surface-card`, agrupador usa `glass-coluna`.
- Texto nunca direto sobre o fundo de estratos. `<StrataBackdrop />` continua montado só no `app/layout.tsx`.
- Status e estágio só em azuis, sempre com texto. Âmbar só para atraso. Sem vermelho ou verde.
- Sem caixa-alta, sem peso 800+, sem emoji. Ícones lucide com `strokeWidth={1.75}`.
- Marca só por `<PrismaMark />` e `<PrismaWordmark />`. Não usar PNG de logo na aplicação.
- Datas, contagens e durações com a classe `num`.
- Interface em pt-BR com o termo "Líderes"; identificadores em inglês.
- Movimento só em resposta a ação do usuário, 150 a 200 ms, respeitando `motion-reduce`.
- Verificar nos temas claro e escuro e em largura de celular.

---

## 5. Conteúdo do pacote

O arquivo `prisma-pagina-inicial-pacote.zip` espelha a estrutura do repositório. Descompactar na raiz.

| Caminho no pacote e no repositório | Conteúdo |
|---|---|
| `docs/specs/pagina-inicial.md` | Este documento |
| `docs/prototipos/pagina-inicial.html` | Protótipo validado (referência visual; não é código de produção). Lê a mídia de `public/onboarding/` por caminho relativo |
| `public/onboarding/posters/*.jpg` | 14 pôsteres, 640 px de largura |
| `public/onboarding/videos/*.mp4` | 14 vídeos comprimidos, 33 MB no total |

O protótipo usa PNG de logo e CSS próprio apenas por ser um arquivo isolado. Na aplicação valem os componentes e tokens existentes.

---

## 6. Rotas

| Rota | Antes | Depois | Exige sessão |
|---|---|---|---|
| `/` | Meu painel (grupo `(app)`, com `AppShell`) | Página inicial pública | Não |
| `/login/` | Tela de login com `AuthCard` | Sem mudança visual. Após o login, segue para `/meu-painel/` | Não |
| `/meu-painel/` | Não existe | Meu painel (grupo `(app)`, com `AppShell`) | Sim |
| `/recuperar-senha/`, `/redefinir-senha/` | `AuthCard` | Sem mudança | Não |
| Demais rotas do app | — | Sem mudança | Sim |

Pontos do código que hoje apontam para a raiz como Meu painel, confirmados na leitura de 27/11/2026:

| Arquivo | Ocorrência |
|---|---|
| `components/app-shell.tsx` | Item `{ href: "/", label: "Meu painel" }` em `NAV`; `<Link href="/">` na marca; caso especial `href === "/"` em `isActive` |
| `app/login/page.tsx` | Três `router.replace("/")` (sessão existente, evento `SIGNED_IN` e sucesso do login por senha) |
| `docs/ARQUITETURA.md` | Texto "com sessão segue para `/`" no retorno do OAuth |

A lista não é exaustiva. A fatia 2 começa por uma busca no repositório.

---

## 7. Estrutura da página inicial

Ordem das seções, de cima para baixo. Âncoras em ASCII.

| # | Seção | Âncora | Camada | Conteúdo |
|---|---|---|---|---|
| 0 | Topo fixo | — | `glass-painel` | `<PrismaWordmark />`, navegação por âncoras, `<ThemeToggle />`, botão principal (P1) |
| 1 | Abertura | `#inicio`, `#acesso` | dentro da lâmina | Título, texto de apoio, dois botões e o cartão de acesso em `surface-card` |
| 2 | Metodologia | — | `surface-card` ×6 | Significado de P, R, I, S, M, A |
| 3 | Funcionalidades | `#funcionalidades` | `surface-card` ×8 | Um card por pílula do Prisma, com link para o vídeo |
| 4 | Vídeos do Prisma | `#videos` | `surface-card` ×8 | Oito pílulas |
| 5 | Vídeos do Discord | `#discord` | `glass-coluna` + `surface-card` ×5 | Guia rápido em destaque, três regras de uso e cinco pílulas |
| 6 | Ferramentas e links | `#ferramentas` | `surface-card` ×8 | Filtro por categoria e aviso sobre credenciais |
| 7 | Fluxo de trabalho | `#fluxo` | `surface-card` ×4 | Planejamento, Execução, Comunicação, Entrega |
| 8 | Boas práticas | — | `surface-card` ×3 | Segurança, Produtividade, Colaboração |
| 9 | Suporte | `#suporte` | `surface-card` ×3 | Primeiros passos, dúvidas frequentes, contato |
| 10 | Rodapé | — | `surface-card` | Identificação e aviso de uso interno |

Todo o conteúdo de 1 a 10 fica dentro de uma única `<main className="glass-lamina">`. Superfícies com blur: topo e lâmina (duas).

**Sem formulário na página inicial.** O cartão de acesso tem o botão principal (P1), o botão "Primeiro acesso" (`#suporte`) e a nota de acesso restrito. O login acontece em `/login/`.

**Botão principal (P1):** enquanto a sessão carrega, mostra "Entrar" apontando para `/login/`. Com sessão, mostra "Ir para o Meu painel" apontando para `/meu-painel/`. Vale para o topo, a abertura e o cartão de acesso.

**Responsivo:** grades de 4 colunas caem para 2 abaixo de 940 px e para 1 abaixo de 600 px. O topo deixa de ser fixo abaixo de 940 px.

**Vídeos:** `<video controls preload="none" playsInline poster="...">` com `<source type="video/mp4">`. Sem autoplay. Cada vídeo tem `aria-label` com o título. O link "Assistir" do card de funcionalidade rola até o vídeo correspondente.

**Filtro de ferramentas:** botões com `aria-pressed`; estado só em memória.

---

## 8. Conteúdo

Todo o conteúdo abaixo vai para `lib/landing/content.ts` como constantes tipadas. Nenhum texto fica solto nos componentes.

### 8.1 Abertura

- Rótulo: Gestão de projetos da Ambiente
- Título: Projetos, prazos e conhecimento da consultoria em um só lugar.
- Texto: O Prisma reúne tarefas, indicadores, relatórios de status e o contexto de cada cliente. Esta página concentra o que a equipe precisa antes de entrar: o que a ferramenta faz, como usar e onde estão os demais sistemas da Ambiente.
- Botões: principal (P1) e "Ver vídeos de uso" (`#videos`)
- Cartão de acesso: título "Acesso"; texto "Entre com seu e-mail corporativo ou com a conta do Discord vinculada."; nota "Acesso restrito à equipe da Ambiente e a convidados autorizados pelo administrador."

### 8.2 Metodologia

| Letra | Nome | Descrição |
|---|---|---|
| P | Processos | Mapeamento e padronização do que é entregue. |
| R | Resultados | Entregas e marcos acordados com o cliente. |
| I | Indicadores | Medição do portfólio dentro da própria ferramenta. |
| S | Sistemas | Ferramentas que sustentam a operação. |
| M | Melhoria | Ações e aprendizados registrados por projeto. |
| A | Alinhamento | Equipe e cliente com a mesma informação. |

### 8.3 Vídeos do Prisma (também alimentam os cards de Funcionalidades)

Caminhos: `/onboarding/videos/<arquivo>.mp4` e `/onboarding/posters/<arquivo>.jpg`.

| # | Arquivo (sem extensão) | Título | Descrição | Duração | Ícone lucide sugerido |
|---|---|---|---|---|---|
| 1 | `prisma_pilula01_acesso_e_navegacao` | Acesso e navegação | Entrar, se orientar pelo menu e vincular o Discord. | 01:09 | `LogIn` |
| 2 | `prisma_pilula02_meu_painel` | Meu painel e notificações | O que você precisa fazer agora, em uma tela. | 01:00 | `LayoutDashboard` |
| 3 | `prisma_pilula03_projetos` | Projetos | Criar, encontrar e configurar um projeto. | 00:50 | `Briefcase` |
| 4 | `prisma_pilula04_tarefas` | Tarefas | Quadro, ficha da tarefa, checklist, anexos e comentários. | 01:11 | `Kanban` |
| 5 | `prisma_pilula05_abas_do_projeto` | As abas do projeto | Lista, Cronograma, Documentos, Contexto, Membros, Escopos e Importar/Exportar. | 01:08 | `PanelsTopLeft` |
| 6 | `prisma_pilula06_visao_do_portfolio` | Visão do portfólio | Cronograma geral, Indicadores e Documentos. | 00:46 | `ChartColumn` |
| 7 | `prisma_pilula07_assistente_discord` | O assistente no Discord | Consultar e atualizar o Prisma conversando. | 01:04 | `MessageCircle` |
| 8 | `prisma_pilula08_administracao` | Administração | Conhecimento, clientes, parâmetros, usuários, permissões e auditoria. | 00:55 | `Settings` |

Título da seção: "Passo a passo em oito pílulas de cerca de um minuto".

### 8.4 Vídeos do Discord

| # | Arquivo (sem extensão) | Título | Descrição | Duração |
|---|---|---|---|---|
| Guia | `discord_video_completo` | Agente Prisma no Discord | O conteúdo das cinco pílulas em um único vídeo, para quem está chegando ao servidor. | 02:15 |
| 1 | `discord_pilula01_primeiros_passos` | Primeiros passos no servidor | Vincule a conta e conheça os canais. | 00:47 |
| 2 | `discord_pilula02_como_pedir` | Como pedir ao assistente | Mensagem direta, menção no canal e consultas. | 00:52 |
| 3 | `discord_pilula03_previa_e_confirmacao` | Prévia e confirmação | Nada é gravado sem você. | 00:39 |
| 4 | `discord_pilula04_arquivos_e_audio` | Arquivos e áudio | O assistente lê documentos e ouve pedidos. | 00:32 |
| 5 | `discord_pilula05_skills` | Como usar uma skill | Na mensagem direta e nos canais. | 01:09 |

Regras exibidas ao lado do guia rápido:

1. **No canal, a resposta é vista por todos.** Para dados sensíveis, prefira a mensagem direta.
2. **Nada é gravado sem a sua confirmação.** O assistente mostra uma prévia e aguarda o aceite.
3. **Você vê o mesmo que vê no Prisma.** As permissões do seu perfil valem nas respostas.

### 8.5 Ferramentas e links

| Categoria | Ferramenta | Descrição | Link | Como obter acesso |
|---|---|---|---|---|
| Criação de conteúdo | Gamma App | Apresentações geradas a partir de prompts ou esboços, responsivas e com edição em tempo real. | `https://gamma.app` | Conta compartilhada da Ambiente. Solicite ao administrador. |
| Criação de conteúdo | Canva | Templates, Brand Kit e exportação em PDF, PNG e MP4 para materiais visuais. | `https://www.canva.com` | Conta operacional compartilhada. Solicite ao administrador. |
| Colaboração | Miro | Quadro para ideação, mapeamento de processos e facilitação de workshops. | `https://miro.com` | Conta compartilhada da Ambiente. Solicite ao administrador. |
| Colaboração | Discord da Ambiente | Um canal por projeto e o assistente de IA do Prisma por mensagem direta. | `https://discord.com/app` | Convite enviado pelo administrador. |
| Gestão de projetos | Modelo de importação | Arquivo padrão para subir tarefas e cronogramas no Prisma. | nulo (A5) | Disponível a toda a equipe. |
| Inteligência artificial | ChatGPT | Apoio à redação, pesquisa, análise, revisão e aprendizado. | `https://chatgpt.com` | Sob alinhamento com a gestão do departamento. |
| Inteligência artificial | Fireflies.ai | Gravação, transcrição em português e resumo de reuniões no Zoom, Meet e Teams. | `https://app.fireflies.ai` | Conta compartilhada da Ambiente. Solicite ao administrador. |
| Normas e conformidade | Target Normas | Consulta a normas ABNT, ISO, IEC e ASTM, com histórico de versões e alertas de atualização. | `https://www.target.com.br` (confirmar, A5) | Conta da diretoria, com senha renovada periodicamente. Solicite ao administrador. |

Aviso abaixo da grade: **Credenciais:** logins e senhas compartilhados ficam em área restrita após o login ou em um gerenciador de senhas. Esta página é aberta e não os exibe.

Links externos abrem com `target="_blank"` e `rel="noopener noreferrer"`.

### 8.6 Fluxo de trabalho

| Etapa | Texto |
|---|---|
| 1. Planejamento | Miro para o levantamento inicial. Prisma para estruturar o projeto com tarefas e prazos. |
| 2. Execução | Fireflies registra as reuniões, Target Normas valida a conformidade e o assistente no Discord guarda o contexto. |
| 3. Comunicação | Canva e Gamma para apresentações. Relatório de status do Prisma para o cliente. |
| 4. Entrega | Prisma consolida entregas, indicadores e o histórico do projeto para os próximos trabalhos. |

### 8.7 Boas práticas

| Bloco | Itens |
|---|---|
| Segurança da informação | Não compartilhe credenciais com terceiros. · Faça logout em dispositivos compartilhados. · Prefira a mensagem direta para dados sensíveis de projeto. |
| Produtividade | Atualize suas tarefas no Prisma todos os dias. · Crie templates reutilizáveis no Canva e no Gamma. · Mantenha os quadros do Miro organizados e arquive os finalizados. |
| Colaboração | Converse sobre o projeto no canal dele no Discord. · Marque os colegas envolvidos para dar visibilidade. · Registre decisões e aprendizados no contexto do projeto. |

### 8.8 Suporte

**Primeiros passos**

1. **Receba o convite.** O administrador cadastra seu e-mail corporativo.
2. **Defina sua senha.** O link chega por e-mail.
3. **Assista à pílula 1.** Um minuto para entender o acesso e o menu.
4. **Vincule o Discord.** Em Minha conta, para usar o assistente.

**Dúvidas frequentes**

| Pergunta | Resposta |
|---|---|
| Não recebi o convite. O que faço? | Confira a caixa de spam e peça o reenvio ao administrador. |
| O cliente consegue ver todo o projeto? | Não. O convidado externo vê e atualiza apenas as tarefas atribuídas ou compartilhadas com ele. |
| O assistente não respondeu no canal. Por quê? | No canal, ele só responde quando é mencionado: escreva @prisma na mensagem. Pedidos em áudio só são transcritos na mensagem direta. |

**Contato:** Iago Oliveira · `iago@ambienteconsulta.com.br` · botão "Solicitar acesso" (`mailto:` com assunto "Prisma - solicitação de acesso"). O e-mail também aparece como texto.

---

## 9. Arquivos do repositório

**Existentes, confirmados na leitura de 27/11/2026:**

| Caminho | Papel nesta entrega |
|---|---|
| `components/app-shell.tsx` | `NAV`, link da marca e `isActive` passam a usar `/meu-painel/` |
| `app/login/page.tsx` | Os três `router.replace("/")` passam a `/meu-painel/`. Nada mais muda |
| `components/auth-provider.tsx` (`useAuth`) | Lido pela página inicial para o botão principal (P1) |
| `components/brand/prisma-mark.tsx`, `components/theme-toggle.tsx`, `components/ui/button.tsx` | Usados no topo e nos botões |
| `components/auth-card.tsx`, `app/globals.css`, `app/layout.tsx`, `public/.htaccess`, `next.config.ts` | Não mudam |
| `docs/ARQUITETURA.md`, `docs/ROADMAP-MELHORIAS.md` | Atualizados |

**A localizar (não confirmado):** o arquivo da página do Meu painel. A navegação indica a raiz dentro do grupo `(app)`; o caminho esperado é `app/(app)/page.tsx`. Se não for, parar e informar.

**Novos:**

| Caminho | Conteúdo |
|---|---|
| `lib/routes.ts` | Constantes `HOME_ROUTE = "/"`, `LOGIN_ROUTE = "/login/"`, `PANEL_ROUTE = "/meu-painel/"` |
| `app/(app)/meu-painel/page.tsx` | Página do Meu painel, movida sem alteração de conteúdo |
| `app/page.tsx` | Página inicial |
| `lib/landing/content.ts`, `lib/landing/content.test.ts` | Conteúdo da seção 8 e testes de integridade |
| `components/landing/landing-header.tsx` | Topo |
| `components/landing/landing-hero.tsx` | Abertura e cartão de acesso |
| `components/landing/video-card.tsx` | Player com pôster |
| `components/landing/tools-section.tsx` | Grade com filtro |
| `components/landing/landing-sections.tsx` | Metodologia, Funcionalidades, Vídeos, Fluxo, Boas práticas, Suporte, Rodapé |
| `public/onboarding/posters/*.jpg`, `public/onboarding/videos/*.mp4` | Mídia do pacote |
| `docs/specs/pagina-inicial.md`, `docs/prototipos/pagina-inicial.html` | Este documento e o protótipo |

---

## 10. Execução em três fatias

**Item do roadmap:** não existe. Na fatia 1, incluir uma linha na seção 1 de `docs/ROADMAP-MELHORIAS.md` com o próximo número livre da série `I` (interface), título "Página inicial pública e rota do Meu painel", escopo resumido desta especificação, status 🟡, e registrar na seção 3 a decisão de 27/11/2026 (linha D1 da seção 2 deste documento). Branch: `feat/<id>-pagina-inicial`.

Uma fatia por sessão. Nenhuma fatia tem migração ou Edge Function. Cada fatia deixa o site publicável.

### Fatia 1 · Conteúdo e mídia

```text
TAREFA
Criar a camada de conteúdo da página inicial do Prisma, incluir a mídia e registrar o item no roadmap. Sem alterar nenhuma tela nem rota.

LEIA ANTES
- CLAUDE.md
- docs/specs/pagina-inicial.md (seções 2, 4, 5, 8 e 10)
- docs/ROADMAP-MELHORIAS.md

ARQUIVOS
Criar:
- lib/landing/content.ts
- lib/landing/content.test.ts
Adicionar (já fornecidos, não reprocessar):
- public/onboarding/posters/*.jpg (14)
- public/onboarding/videos/*.mp4 (14)
- docs/specs/pagina-inicial.md
- docs/prototipos/pagina-inicial.html
Editar:
- docs/ROADMAP-MELHORIAS.md (nova linha na seção 1 com o próximo ID livre da série I; decisão de 27/11/2026 na seção 3)
Não tocar em nenhum outro arquivo.

REQUISITOS
1. content.ts exporta tipos e constantes somente leitura para: hero, accessCard, method, prismaVideos, discordGuide, discordVideos, discordRules, toolCategories, tools, workflow, practices, firstSteps, faq, contact, navItems.
2. Cada vídeo tem: id, file, title, description, duration (texto "mm:ss") e, nos do Prisma, icon (nome do ícone lucide). Os caminhos de src e poster são derivados de file por função exportada.
3. tools aceita href nulo. Nenhuma credencial, senha ou e-mail de conta compartilhada no arquivo.
4. Textos exatamente como na seção 8 da especificação. Sem organograma e sem Redmine.

CRITÉRIOS DE ACEITE
- 8 vídeos do Prisma, 1 guia e 5 pílulas do Discord, 8 ferramentas em 5 categorias.
- O link da ferramenta Discord é https://discord.com/app.
- Teste verifica: ids únicos; para cada vídeo, existência de public/onboarding/videos/<file>.mp4 e public/onboarding/posters/<file>.jpg; todo href não nulo começa com https://; toda ferramenta pertence a uma categoria declarada; nenhuma ocorrência de "senha:", "password" ou "redmine" no conteúdo.
- Nenhum vídeo acima de 6 MB e pasta de vídeos abaixo de 40 MB (verificado no teste).
- ROADMAP-MELHORIAS.md tem a nova linha com status 🟡 e a decisão registrada.

VALIDAÇÃO
npm run lint && npm run typecheck && npm test && npm run build

SAÍDA
Somente: ID atribuído ao item, lista de arquivos criados e editados, resultado de cada comando de validação e pendências. Sem narrativa.
```

### Fatia 2 · Rota do Meu painel

```text
TAREFA
Mover o módulo Meu painel da raiz para /meu-painel/ e ajustar todas as referências, sem alterar o conteúdo nem o comportamento do painel. A raiz passa a ser um redirecionamento provisório no cliente.

LEIA ANTES
- CLAUDE.md
- docs/specs/pagina-inicial.md (seções 2, 4, 6 e 9)
- components/app-shell.tsx, app/login/page.tsx

PRIMEIRO PASSO (antes de editar)
Localizar o arquivo da página do Meu painel e listar todas as referências à raiz como destino de navegação: href="/", router.replace("/"), router.push("/"), redirectTo terminando em origin + "/", e textos de documentação. Buscar em app/, components/, lib/, supabase/functions/, supabase/templates/ e docs/. Se o Meu painel não estiver em app/(app)/page.tsx, ou se houver referência à raiz em Edge Function ou template de e-mail, parar e informar.

ARQUIVOS
Criar:
- lib/routes.ts (HOME_ROUTE, LOGIN_ROUTE, PANEL_ROUTE)
- app/(app)/meu-painel/page.tsx (conteúdo movido, sem alteração)
- app/page.tsx (provisório: componente cliente que usa useAuth; com sessão, router.replace(PANEL_ROUTE); sem sessão, router.replace(LOGIN_ROUTE); enquanto carrega, PrismaMark com animate-pulse e motion-reduce)
Remover:
- a página antiga do Meu painel na raiz do grupo (app)
Editar:
- components/app-shell.tsx (NAV, link da marca e isActive usando PANEL_ROUTE; remover o caso especial de "/")
- app/login/page.tsx (os três destinos pós-login passam a PANEL_ROUTE)
- demais arquivos encontrados no primeiro passo
- docs/ARQUITETURA.md (retorno do OAuth e tabela de rotas)
- docs/ROADMAP-MELHORIAS.md (fatia concluída entre parênteses)
Não tocar em: supabase/, app/globals.css, app/layout.tsx, public/.htaccess, next.config.ts, lógica de dados do painel.

CRITÉRIOS DE ACEITE
- /meu-painel/ exibe o Meu painel idêntico ao atual, dentro do AppShell, com o item "Meu painel" marcado como página atual.
- Sem sessão, /meu-painel/ leva a /login/ (comportamento do AppShell preservado).
- Login por e-mail e senha e login pelo Discord terminam em /meu-painel/. O redirectTo do OAuth continua /login/.
- A raiz redireciona no cliente: com sessão para /meu-painel/, sem sessão para /login/.
- A marca no menu lateral leva a /meu-painel/.
- Nenhuma ocorrência restante de navegação para "/" como Meu painel (repetir a busca do primeiro passo).
- Build estático gera out/meu-painel/index.html e out/index.html.

VALIDAÇÃO
npm run lint && npm run typecheck && npm test && npm run build
test -f out/meu-painel/index.html && test -f out/index.html
Verificação manual em npm run dev: login por senha, sair, acesso direto a /meu-painel/ sem sessão, navegação pelo menu.

SAÍDA
Somente: caminho original do Meu painel, lista de referências encontradas e como cada uma foi tratada, arquivos criados, removidos e editados, resultado de cada comando de validação e pendências. Sem narrativa.
```

### Fatia 3 · Página inicial

```text
TAREFA
Substituir o redirecionamento provisório da raiz pela página inicial pública do Prisma, conforme docs/specs/pagina-inicial.md.

LEIA ANTES
- CLAUDE.md
- docs/IDENTIDADE-VISUAL.md
- docs/specs/pagina-inicial.md (seções 2, 4, 7 e 9)
- docs/prototipos/pagina-inicial.html (referência de layout; não copiar CSS nem hex)
- lib/landing/content.ts, lib/routes.ts, components/brand/prisma-mark.tsx, components/theme-toggle.tsx

ARQUIVOS
Criar:
- components/landing/landing-header.tsx
- components/landing/landing-hero.tsx
- components/landing/video-card.tsx
- components/landing/tools-section.tsx
- components/landing/landing-sections.tsx
Editar:
- app/page.tsx
- docs/ARQUITETURA.md (página inicial e pasta public/onboarding)
- docs/ROADMAP-MELHORIAS.md (status ✅ e PR)
Não tocar em: app/login/page.tsx, components/auth-card.tsx, components/app-shell.tsx, app/globals.css, app/layout.tsx, supabase/, public/.htaccess, next.config.ts.

REQUISITOS
1. app/page.tsx renderiza o topo (glass-painel) e uma única <main className="glass-lamina"> com as seções na ordem da seção 7 da especificação.
2. Todo texto vem de lib/landing/content.ts. Rotas vêm de lib/routes.ts.
3. Sem formulário de login na página. Botão principal: "Entrar" para LOGIN_ROUTE; com sessão (useAuth), "Ir para o Meu painel" para PANEL_ROUTE. A página não redireciona quem tem sessão.
4. Marca por <PrismaWordmark />. Tema por <ThemeToggle />.
5. Vídeos: <video controls preload="none" playsInline poster> com aria-label; sem autoplay.
6. Links "Assistir" dos cards de funcionalidade levam à âncora do vídeo correspondente. Navegação do topo por âncoras; rolagem suave desativada com motion-reduce.
7. Filtro de ferramentas com botões reais e aria-pressed. Ferramenta com href nulo não exibe botão de link.
8. Links externos com target="_blank" e rel="noopener noreferrer".
9. Regras da seção 4 da especificação: tokens, camadas de vidro, sem caixa-alta, sem emoji, sem vermelho ou verde, classe num em durações.

CRITÉRIOS DE ACEITE
- A raiz mostra a página inicial com e sem sessão; o rótulo e o destino do botão principal mudam conforme a sessão.
- /login/, /recuperar-senha/ e a tela de redefinição não mudam.
- No máximo duas superfícies com backdrop-filter na página; nenhum blur aninhado; nenhum hex, rgb() ou cor nomeada do Tailwind nos componentes novos.
- 14 players na página, cada um com pôster; nenhum vídeo é baixado antes do clique.
- 8 ferramentas; a do Discord abre https://discord.com/app. Sem organograma e sem Redmine.
- Sem rolagem horizontal em 375 px de largura. Legível nos temas claro e escuro.
- Foco visível em todos os controles; ordem de tabulação segue a ordem visual.
- Nenhuma credencial em nenhum arquivo.
- Build estático copia public/onboarding para out/onboarding.

VALIDAÇÃO
npm run lint && npm run typecheck && npm test && npm run build
ls out/onboarding/videos | wc -l   (deve retornar 14)
Verificação manual em npm run dev: temas claro e escuro, larguras de 375 px e 1280 px, raiz com e sem sessão.

SAÍDA
Somente: lista de arquivos criados e editados, resultado de cada comando de validação, itens do checklist de PR de UI (docs/IDENTIDADE-VISUAL.md §12) marcados e pendências. Sem narrativa.
```

---

## 11. Vídeos: referência de compressão

Os arquivos do pacote já estão comprimidos. Comando usado, para vídeos futuros:

```bash
ffmpeg -i entrada.mp4 -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart saida.mp4
```

Pôster de cada vídeo (quadro aos 3 s, 640 px de largura):

```bash
ffmpeg -ss 3 -i entrada.mp4 -frames:v 1 -vf scale=640:-2 -q:v 4 saida.jpg
```

---

## 12. Fora do escopo

- Organograma e fotos da equipe.
- Área restrita de credenciais das ferramentas.
- Vídeos protegidos por login.
- Seção de novidades ou histórico de versões.
- Qualquer alteração de schema, policy, Edge Function, template de e-mail ou configuração de autenticação.

---

## 13. Pendências

1. A5: endereços do modelo de importação e do portal do Target Normas.
2. P1: confirmar que usuário com sessão permanece na página inicial (alternativa: redirecionar para `/meu-painel/`).
3. Comunicar à equipe a mudança de endereço do Meu painel.
