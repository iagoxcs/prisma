# Migração para a identidade "Estratos" — roteiro para o Claude Code

Cole o bloco abaixo no Claude Code, em **plan mode**.

```
Leia CLAUDE.md e docs/IDENTIDADE-VISUAL.md. Os arquivos app/globals.css, app/layout.tsx,
components/app-shell.tsx, components/theme-toggle.tsx, components/brand/*, lib/theme/*
já foram substituídos/adicionados com a nova identidade. Monte um plano para alinhar o
restante do código, sem alterar regras de negócio, queries ou RLS:

1. Varra app/ e components/ (exceto components/ui) atrás de hex, rgb(), hsl() e cores
   nomeadas do Tailwind (slate-, blue-, red-, green-, amber-…). Liste ocorrências por arquivo.
2. Substitua STATUS_COLOR em app/(app)/cronograma/page.tsx por PROJECT_STATUS_COLOR
   (lib/theme/status.ts) e troque o contorno vermelho de atraso por var(--warning).
   Verifique se components/gantt-chart.tsx aceita var(--token) como cor; ajuste se necessário.
3. Kanban e listas de tarefas: colunas com glass-coluna, cards com surface-card, prazo
   vencido com selo âmbar + texto, datas/contagens com o utilitário num.
4. Remova font-semibold em h1 de páginas (a escala base já define pesos) e qualquer
   uppercase/tracking-wide em rótulos.
5. Garanta que nenhum componente dentro do <main> use backdrop-blur.
6. Seletor de cor de categorias: restringir a CATEGORY_PALETTE.
7. Rode npm run lint && npm run typecheck && npm run build.

Entregue o plano com a lista de arquivos e o diff previsto por arquivo antes de editar.
```

## Pendências que não são resolvidas por esta migração

| # | Item | Dependência |
|---|---|---|
| 1 | Padrão visual dos relatórios HTML | Validação #10 de REQUISITOS.md |
| 2 | Restringir `categories.color` também no banco (check constraint) | Decisão: migração nova |
| 3 | Ícones PWA a partir de `PrismaMark` | Favicon já em `app/icon.svg` (cores do tema claro); faltam os PNG do manifesto |

## Situação

Roteiro aplicado em 05/10/2026 (branch `feat/identidade-visual`): itens 1 a 7 concluídos; lint, typecheck e build passando.
