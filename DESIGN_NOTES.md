# DESIGN_NOTES — VestiCRM

Notas da refatoração de UX/UI + identidade visual (fase de refinamento do MVP).

## Identidade visual aplicada

- **Marca**: VestiCRM — _A plataforma comercial para lojas de moda._
- **Logo**: monograma "V" em duas tonalidades de azul sobre gradiente petróleo→azul
  (`src/components/logo.tsx`), aplicado em login, sidebar, header mobile, favicon
  (`src/app/icon.svg`) e PDF de orçamento.
- **Paleta** (tokens em `src/app/globals.css` → `@theme`):
  - `brand-600 #2563eb` (ação primária), `brand-900 #1e3a5f` (petróleo), `brand-300 #93c5fd`
  - superfícies slate: `canvas #f8fafc`, `surface #fff`, `ink #1e293b`, `sidebar #0f172a`
  - semânticas: sucesso `#10b981`, alerta `#f59e0b`, erro `#ef4444`
- **Sombras** premium slate-tinted, **foco** acessível global (`box-shadow` ring),
  **motion** com `prefers-reduced-motion` respeitado.

## Design System

Componentes centralizados em `src/components/ui.tsx` (fonte única de verdade):
`Card`, `PageHeader`, `Button`, `Input`/`Field`, `Badge`, `Avatar`, `Alert`,
`EmptyState`, `Spinner`, `Skeleton`, `ConvStatusPill`, `PriorityDot`, `SegmentedItem`.
Gráficos em `src/components/charts.tsx` (`StatTile`, `BarList`, `FunnelBars`, `AreaChart`)
com rampa azul única validada (light→dark).

## Alavancas de consistência

- A repaleta é dirigida por **tokens** (`brand-*`, `canvas`, `sidebar`): trocar a marca
  é mudar um bloco. Todas as telas herdam automaticamente.
- **Sidebar escura** (`#0F172A`) colapsável com agrupamento semântico do menu.
- O **catálogo público continua com a identidade personalizada de cada loja**
  (logo/cores/tipografia do lojista) — isso é intencional e permanece.

---

## Sugestões funcionais (NÃO implementadas nesta fase — apenas registro)

Oportunidades observadas durante a revisão de UX. Priorizar pelo uso real das lojas.

1. **Command palette (⌘K)** — busca global de clientes, pedidos, produtos e navegação
   rápida. Alto impacto de produtividade, padrão Linear/Notion.
2. **Toaster global de feedback** — hoje o feedback de sucesso/erro varia por tela
   (mensagens inline). Um provider único de toasts padronizaria confirmações de
   "salvo", "enviado", "erro de rede".
3. **Modo escuro do app** (não só da sidebar) — os tokens já estão prontos; faltaria
   um segundo conjunto de valores e um toggle.
4. **Skeletons de carregamento por rota** — usar `loading.tsx` do App Router com o
   componente `Skeleton` para transições percebidas como instantâneas.
5. **Densidade configurável** (compacto/confortável) para tabelas e listas — útil para
   lojas com muitos pedidos.
6. **Undo em ações destrutivas** (excluir produto, cancelar pedido) via toast com
   "Desfazer" por alguns segundos, em vez de `window.confirm`.
7. **Atalhos no funil** — mover card por teclado, seleção múltipla, filtro por responsável.
8. **Empty states com CTA guiado** — onboarding da loja (primeiro produto, primeiro
   link inteligente, conectar WhatsApp) como checklist inicial.
9. **Acessibilidade**: auditar contraste dos badges soft em telas muito claras e
   adicionar `aria-live` nos toasts/alertas de status.
10. **Virtualização** de listas longas (clientes, eventos de tracking) para manter a
    performance com milhares de registros.
11. **Preferência de tema por usuário** persistida no servidor (hoje sidebar colapsada
    fica em `localStorage`).
