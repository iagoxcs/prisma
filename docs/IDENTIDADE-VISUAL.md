# Identidade Visual — Prisma

**Direção:** Estratos. **Tema claro:** Lâminas. **Tema escuro:** Noturno.
**Fonte de verdade dos valores:** `app/globals.css`. Este documento define **como** usar esses valores. Se houver conflito, o CSS vence e este documento deve ser corrigido.

---

## 1. Conceito

A hierarquia do sistema é representada como **profundidade**: portfólio, projeto e tarefa são camadas sobrepostas. Na interface, isso aparece como **lâminas de vidro** flutuando sobre um campo azul, com os **três estratos da marca** desfocados ao fundo.

Princípios, em ordem de prioridade:

1. **Clareza antes de efeito.** O vidro serve à hierarquia e nunca reduz a legibilidade de dados.
2. **Azul é estrutura, âmbar é exceção.** Toda a interface é construída em azuis. A única cor quente indica atraso ou vencimento.
3. **Calma.** Raios generosos, pesos tipográficos moderados, sombras quase imperceptíveis, sem animação decorativa.
4. **Um ponto memorável.** O fundo de estratos com vidro é a assinatura visual. Nada mais compete com ele.

---

## 2. Cores

### 2.1 Tokens

Nunca usar hex em componentes. Usar sempre as classes Tailwind geradas pelos tokens.

| Papel | Classe Tailwind | Claro | Escuro |
|---|---|---|---|
| Campo de fundo | `bg-background` | `#DCE8F2` | `#081A2E` |
| Texto principal | `text-foreground` | `#163A5C` | `#E6F0F8` |
| Texto secundário | `text-muted-foreground` | `#4A6A88` | `#9FBBD6` |
| Ação primária | `bg-primary` / `text-primary-foreground` | `#163A5C` / branco | `#CFE3F5` / `#081A2E` |
| Ação secundária | `bg-secondary` | `#E3EEF7` | branco 10% |
| Hover / item selecionado leve | `bg-accent` | branco 65% | branco 14% |
| Bordas de campos | `border-input` | `#B9CDE1` | branco 16% |
| Foco | `ring-ring` | `#2A6AA3` | `#6FAAE0` |
| Destaque de marca | `text-brand-mid` | `#2A6AA3` | `#8EC0EE` |
| Atraso / vencimento | `text-warning` + `bg-warning-surface` | `#8A4B00` / `#FFEFD2` | `#F5B455` / âmbar 14% |
| Exclusão (ação irreversível) | `bg-destructive` | `#A8323A` | `#F08A8F` |

### 2.2 Status

Fonte única: `lib/theme/status.ts`. É proibido criar mapas locais de cor de status (o `STATUS_COLOR` atual de `app/(app)/cronograma/page.tsx` deve ser substituído por `PROJECT_STATUS_COLOR`).

| Status | Token | Lógica visual |
|---|---|---|
| Projeto: planejamento / Tarefa: a fazer | `--status-planned` / `--status-todo` | Azul claro (ainda não começou) |
| Projeto: em andamento / Tarefa: fazendo | `--status-active` / `--status-doing` | Azul médio (em movimento) |
| Pausado | `--status-paused` | Azul-acinzentado |
| Concluído / Feito | `--status-done` | Azul mais profundo (assentado) |
| Cancelado | `--status-cancelled` | Neutro apagado |
| **Vencido** (condição, não status) | `--warning` | Âmbar, sempre acompanhado de texto |

Regras:

- **Proibido vermelho e verde para status.** Os status se distinguem por luminosidade, o que garante leitura para daltônicos.
- O atraso **se sobrepõe** ao status: uma tarefa "fazendo" e vencida mantém a cor de "fazendo" e ganha o selo âmbar "vencida 02 out".
- A cor nunca é a única pista: sempre há rótulo, ícone ou texto.
- `destructive` serve apenas para ações de exclusão e erros de formulário, nunca para indicar status.

### 2.3 Categorias (escopos)

`categories.color` deve usar somente `CATEGORY_PALETTE` (8 tons frios). No tema escuro, a interface exibe o par `dark` correspondente. Seletor de cor livre é proibido.

### 2.4 Gráficos (Recharts)

- Séries em ordem: `var(--chart-1)` … `var(--chart-5)`, do tom mais escuro para o mais claro no tema claro.
- Meta ou limite: linha tracejada em `var(--muted-foreground)`.
- Valor fora da meta: `var(--warning)`.
- Grade: `var(--border)` com opacidade 0.6. Sem gradientes em áreas.
- Títulos de gráfico trazem a **conclusão**, não a descrição. Correto: "Lead time caiu 18% no trimestre". Errado: "Gráfico de lead time".

---

## 3. Vidro (glassmorphism)

### 3.1 Camadas

| Camada | Utilitário | Blur | Onde usar |
|---|---|---|---|
| Painel | `glass-painel` | Sim | Navegação lateral, painéis laterais fixos (lista de projetos, detalhes da tarefa em drawer) |
| Lâmina | `glass-lamina` | Sim | Área de trabalho principal (já aplicada no `AppShell` ao `<main>`), telas de login e acesso |
| Coluna | `glass-coluna` | **Não** | Agrupadores dentro da lâmina: colunas do Kanban, seções de formulário, blocos de indicadores |
| Card | `surface-card` | **Não** | Itens repetidos: cards de tarefa, linhas, itens de lista, comentários |
| Popover / diálogo | `bg-popover` (shadcn) | Não | Menus, selects, diálogos e toasts são **sólidos** |

### 3.2 Regras

1. **Nunca aninhar `backdrop-filter`.** Dentro de uma lâmina, use apenas `glass-coluna` e `surface-card`.
2. **Proibido blur em elementos repetidos.** Cards de Kanban, linhas de tabela e itens de lista com Realtime não podem ter blur, por custo de renderização.
3. **Máximo de três superfícies com blur visíveis ao mesmo tempo** (ex.: painel + lâmina + um drawer).
4. Texto **nunca** fica direto sobre o fundo de estratos: sempre sobre uma superfície.
5. O fundo `<StrataBackdrop />` é montado **uma única vez** no `layout.tsx`. Não duplicar, animar nem substituir por blobs ou gradientes.
6. `prefers-reduced-transparency` e navegadores sem `backdrop-filter` já recebem superfícies sólidas pelo CSS. Não remova esses blocos.

---

## 4. Tipografia

| Família | Uso |
|---|---|
| **Red Hat Display** (`font-sans`, `font-heading`) | Toda a interface |
| **Red Hat Mono** (utilitário `num`) | Somente dados: datas, contagens, percentuais, códigos (`PRJ-0142`), valores monetários em tabelas |

### Escala

| Nível | Tamanho / peso | Uso |
|---|---|---|
| H1 | 32px / 700, tracking −1,5% | Título da página (um por tela) |
| H2 | 22px / 700, tracking −1% | Seções |
| H3 | 17px / 600 | Títulos de coluna, cards de destaque |
| Corpo | 15px / 400–500 | Texto padrão e títulos de cards (500) |
| Pequeno | 13px / 500 | Metadados, rótulos de campos |
| Mínimo | 12px | Somente com `num` (contagens em badges) |

Regras:

- **Proibido peso 800 ou superior.** O sistema é suave.
- **Proibido CAIXA-ALTA em rótulos, botões ou cabeçalhos.** Usar caixa de sentença.
- Não destacar uma palavra isolada de um título com cor, itálico ou negrito.
- Metadados vão em elementos separados com `gap`, não concatenados com "·" em uma string única.

---

## 5. Forma e espaço

| Token | Valor | Uso |
|---|---|---|
| `rounded-md` | ≈13px | Botões, inputs, itens de navegação, badges |
| `rounded-lg` | 16px | Cards (`surface-card`) |
| `rounded-xl` | ≈22px | Colunas (`glass-coluna`) |
| `rounded-2xl` | ≈28px | Painéis e lâminas |
| `rounded-full` | — | Somente avatares e barras de progresso |

- Espaçamento base de 4px. Gaps entre lâminas: `gap-5` (20px). Padding interno da lâmina: `p-7` (28px).
- Área de toque mínima de 44px (`min-h-11`) em itens clicáveis.
- Sombras: apenas as embutidas nos utilitários (`glass-painel`, `surface-card`). Não adicionar `shadow-*` avulsas.

---

## 6. Marca

- Componente: `<PrismaMark />` (símbolo) e `<PrismaWordmark />` (símbolo + nome).
- O símbolo são **três estratos** formando um triângulo. As cores vêm de `--mark-1..3` e trocam com o tema.
- Tamanho mínimo: 20px de largura. Área de proteção: metade da altura do símbolo em todos os lados.
- Proibido: recolorir manualmente, rotacionar, aplicar sombra ou brilho, usar gradiente, separar os estratos, usar sobre fotografia.
- O nome é sempre "Prisma", em caixa de sentença, Red Hat Display 700.
- Favicon: exportar o símbolo em SVG com as cores do tema claro.

---

## 7. Componentes

| Componente | Especificação |
|---|---|
| Botão primário | `bg-primary text-primary-foreground rounded-md h-11 px-5 font-semibold`. No máximo um por tela/área. |
| Botão secundário | `variant="outline"` ou `ghost` do shadcn, sem cor própria |
| Alternador de visão (Kanban/Gantt/Relatórios) | Grupo segmentado: contêiner `bg-muted rounded-lg p-1`; item ativo `bg-surface-card` (claro) / `bg-accent` (escuro) |
| Card de tarefa | `surface-card p-4 gap-2.5`: categoria (13px, `text-brand-mid`, 600) → título (15–16px, 500) → barra de progresso do checklist (4px, `rounded-full`, `bg-status-doing` sobre `bg-brand-shallow`) → linha de meta (avatar, `num` checklist, prazo) |
| Selo de vencimento | `bg-warning-surface text-warning rounded-md px-2.5 num text-xs`, texto "vencida 02 out" |
| Avatar | Círculo de 26–32px, `bg-brand-shallow text-foreground`, iniciais em `num` |
| Badge de status | Ponto de 8px na cor do status + rótulo em `text-foreground`. Não usar fundo colorido cheio. |
| Coluna do Kanban | `glass-coluna p-3.5 gap-2.5`; cabeçalho: nome (600) + contagem (`num text-muted-foreground`) |
| Tabela | Cabeçalho `text-muted-foreground text-sm font-medium`, linhas de 52px com `border-b`, números à direita em `num` |
| Ícones | lucide-react, `strokeWidth={1.75}`, 18px na navegação e 16px inline. Sem ícones preenchidos e sem emoji. |
| Estado vazio | Frase que direciona a ação ("Nenhuma tarefa neste escopo. Crie a primeira.") + botão. Sem ilustrações genéricas. |
| Carregamento | `PrismaMark` com `animate-pulse` (respeitando `motion-reduce`) ou skeleton em `bg-muted`. |

---

## 8. Movimento

- Apenas como resposta a uma ação do usuário (abrir drawer, mover card, confirmar). Duração de 150–200ms, `ease-out`.
- Proibido: animação de entrada em lista, hover com escala, parallax no fundo de estratos.
- Sempre respeitar `motion-reduce`.

---

## 9. Acessibilidade

- Contraste mínimo de 4.5:1 para texto e 3:1 para texto ≥ 24px e ícones. Os pares de tokens acima já atendem. Ao criar combinações novas, validar.
- Foco visível: contorno de 2px em `--ring` (global, não remover).
- Elementos interativos são `<button>`, `<a>` ou `<input>` reais. Proibido `onClick` em `div`.
- Botões só com ícone precisam de `aria-label`.

---

## 10. Tema

- Três preferências: automático (padrão), claro e escuro. Alternância pelo `<ThemeToggle />` no cabeçalho, com persistência em `localStorage` (`prisma-theme`).
- O script inline do `layout.tsx` aplica `.dark` antes do primeiro paint. Não removê-lo nem trocá-lo por uma biblioteca, já que o export é estático.
- Toda tela nova deve ser verificada nos dois temas antes do PR.

---

## 11. Fora do escopo desta versão

- **Relatórios HTML (One Page / status report):** o padrão visual depende da validação #10 de `REQUISITOS.md`. Até a decisão, os relatórios não herdam vidro nem fundo de estratos (são renderizados em `iframe sandbox` e podem ser impressos).
- **Gantt:** barras usam `PROJECT_STATUS_COLOR` / `TASK_STATUS_COLOR`. Contorno de atraso em `var(--warning)` (substitui o contorno vermelho atual).

---

## 12. Checklist de PR (UI)

- [ ] Nenhum hex, `rgb()` ou cor nomeada do Tailwind (`blue-600`, `red-500`…) em componentes.
- [ ] Status de projeto e tarefa via `lib/theme/status.ts`.
- [ ] Atraso em âmbar, com texto. Nenhum vermelho ou verde para status.
- [ ] Nenhum `backdrop-filter` aninhado e nenhum blur em item repetido.
- [ ] Datas e contagens com `num`.
- [ ] Sem CAIXA-ALTA, sem peso 800+, sem emoji.
- [ ] Testado em tema claro e escuro, e em largura de celular.
- [ ] Termo "Líderes" na interface quando se referir a Gerentes, Coordenadores ou Supervisores.
