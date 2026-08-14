# AtacadoPro

SaaS multi-tenant de **CRM + vendas para moda no atacado** (confecções, lojistas
e revendedoras brasileiras), com foco em vender pelo **WhatsApp**.

> ⚠️ **ESTE SISTEMA ESTÁ EM PRODUÇÃO** em https://www.atacadopro.com, com lojas
> reais pagantes. Não existe ambiente de homologação: **push na branch de deploy
> = produção em ~3 minutos**. Leia [`docs/PRIMEIRO-DIA.md`](docs/PRIMEIRO-DIA.md)
> antes de escrever a primeira linha.

| Documento | Para quê |
| --- | --- |
| [`docs/PRIMEIRO-DIA.md`](docs/PRIMEIRO-DIA.md) | Do computador zerado ao sistema rodando. **Comece por aqui.** |
| [`docs/INCIDENTES.md`](docs/INCIDENTES.md) | Os erros que já custaram dinheiro real e as regras que nasceram deles. |
| [`docs/ESTADO-DO-PROJETO.md`](docs/ESTADO-DO-PROJETO.md) | O que está no ar, o que está pendente, onde paramos. |
| [`docs/PRODUCAO.md`](docs/PRODUCAO.md) | Deploy, variáveis de ambiente e migrações. |
| [`CLAUDE.md`](CLAUDE.md) | Regras de negócio centrais (fonte da verdade). |
| [`.env.example`](.env.example) | Mapa de TODAS as variáveis de ambiente, comentadas. |
| [`docs/IMPORTAR-CATALOGO.md`](docs/IMPORTAR-CATALOGO.md) | Formato do arquivo de importação de catálogo. |
| [`DESIGN_NOTES.md`](DESIGN_NOTES.md) | Identidade visual, tokens de cor e design system. |

## Tamanho e forma do projeto

Números conferidos no repositório (agosto/2026):

| | |
| --- | --- |
| Linhas de código | ~118.000 |
| Rotas de API (`route.ts`) | 186 |
| Modelos no banco | 89 |
| Migrações SQL versionadas | 88 |
| Telas autenticadas | 39 |
| Arquivos de teste (vitest) | 106 — **1.454 testes**, todos passando |

## Stack

- **Next.js 15.5** (App Router) + **React 19** + **TypeScript** + **Tailwind 4**
- **Prisma 6** + **PostgreSQL** (Neon em produção, `sa-east-1`)
- **Vitest** para testes (`npm test`)
- **Vercel** (plano Hobby) — deploy automático a cada push
- Auth própria: JWT assinado com `jose`, em cookie httpOnly

Dependências de peso: `pdf-lib` (orçamentos/etiquetas), `sharp` (imagens),
`qrcode`, `web-push` (notificações PWA), `zod` (validação em toda rota).

## Rodando localmente

```bash
npm install

bash scripts/dev-postgres.sh          # sobe um Postgres local na porta 5433
export DATABASE_URL="postgresql://vesti@127.0.0.1:5433/vesticrm?schema=public"
export AUTH_SECRET="qualquer-coisa-com-mais-de-16-caracteres"

npm run db:deploy                     # aplica as 88 migrações
npm run db:seed                       # popula a loja demo "Bella Moda"
npm run dev
```

Logins de demonstração (senha `demo1234`):

| E-mail | Papel |
| --- | --- |
| `super@vesticrm.com.br` | Super Admin da plataforma |
| `ana@bellamoda.com.br` | Administradora da loja |
| `carla@bellamoda.com.br` | Gerente |
| `julia@bellamoda.com.br` | Vendedora (vê só a própria carteira) |
| `marcos@urbanstyle.com.br` | Admin de **outra** loja — prova o isolamento multi-tenant |

> 🚫 `npm run db:seed` **APAGA O BANCO** (34 `deleteMany` antes de popular). Há
> uma trava: ele se recusa a rodar se o banco não for local **ou** se
> `NODE_ENV=production`, a menos que `ALLOW_PROD_SEED=true`. Ainda assim, nunca
> aponte o `DATABASE_URL` de produção para ele.

## Mapa do código

```
src/
├── app/
│   ├── (app)/…            39 telas autenticadas (dashboard, funil, whatsapp, pedidos…)
│   ├── api/…              186 rotas REST
│   ├── catalogo/[slug]    catálogo público da loja (sem login)
│   ├── bio/[slug]         página de bio pública (linktree próprio)
│   └── declaracao/[id]    declaração de conteúdo dos Correios
├── components/            AppShell, design system (ui.tsx), gráficos SVG
├── lib/                   ⭐ TODA a regra de negócio vive aqui
│   ├── catalogo/          pedido do catálogo público, leitor de mensagem do WhatsApp
│   ├── comm/              Communication Engine (WhatsApp, agnóstico de provedor)
│   ├── integrations/      contratos de sincronização de catálogo
│   ├── plano-corte/       leitura de CAD (Audaces/DXF) e otimizador de encaixe
│   ├── tracking/          eventos do catálogo → tela Inteligência
│   └── __tests__/         96 arquivos de teste
└── middleware.ts          proteção de rotas
prisma/
├── schema.prisma          89 modelos, comentados em português
└── migrations/            88 migrações ESCRITAS À MÃO (ver docs/PRODUCAO.md)
```

**A regra de ouro da arquitetura:** tela não sabe regra de negócio. Tela chama
rota, rota valida e chama motor em `src/lib`, motor decide. Se você está
escrevendo `if` de negócio dentro de um `.tsx`, provavelmente está no lugar
errado.

## As 6 regras que não se negociam

Cada uma nasceu de um incidente real. O detalhe de cada história está em
[`docs/INCIDENTES.md`](docs/INCIDENTES.md).

1. **`companyId` em TODA query.** Multi-tenant é a promessa central do produto —
   uma loja jamais pode ver dados de outra. Os filtros vivem em `src/lib/scope.ts`.
2. **Faturamento soma `netTotal`, nunca `total`.** `total` inclui frete e serve só
   para cobrar da cliente. O teste `faturamento-data.test.ts` varre as telas de
   dinheiro atrás de violações.
3. **Venda = `Order` com status em `PAID_ORDER_STATUSES`.** O modelo `Sale` é
   legado do fluxo manual — **não usar para métrica nenhuma**.
4. **Máximo 2 cron jobs na Vercel, ambos diários.** Um terceiro cron (ou um cron
   não-diário) bloqueia TODOS os deploys silenciosamente. O guard
   `scripts/check-vercel-crons.mjs` roda no build e falha se você violar.
5. **Migrações são escritas à mão.** O banco tem drift; `prisma migrate dev` gera
   lixo. Escreva o `.sql` você mesmo.
6. **Revisão especialista obrigatória antes de todo push** (`/code-review`, nível
   high). Exceção: mudança trivial sem lógica — texto, cor, label.

## Módulos do produto

O que cada loja enxerga é controlado por `CompanyModule` (chaves: `PRODUCAO`,
`MARKETING`, `BIBLIOTECA`, `ENVIOS`, `PLANO_CORTE`, `INTELIGENCIA`).

- **CRM** — clientes/carteira, funil kanban, tarefas, automações, campanhas,
  tags e interesses, notificações (sino + push PWA).
- **Central de Atendimento WhatsApp** (`/whatsapp`) — fila, chats, setores,
  transferência, notas com @menção, respostas rápidas, mídia e áudio, pedido
  dentro do chat. Sync incremental a cada 3s. **Em produção de verdade**, via
  Evolution API self-hosted (WhatsApp não-oficial).
- **Catálogo público** (`catalago.net/{loja}`) — preço sempre recalculado no
  servidor, links rastreados `?ref=` (vendedora) e `?c=` (cliente).
- **Pedidos e estoque** — orçamento reserva estoque; `InventoryMovement` audita
  toda entrada e saída; PDF de orçamento e romaneio.
- **Financeiro** — Pix e cartão por Mercado Pago e InfinitePay (confirmação
  automática), contas a receber, NF-e via Bling, comissões com extrato em PDF.
- **Envios** — Melhor Envio por loja: cotar, comprar etiqueta, imprimir
  declaração, rastrear.
- **Produção** — tecidos, rolos, cortes multi-cor, costura, facções, defeitos,
  plano de corte lendo arquivo do Audaces/DXF.
- **Marketing** — gestor de bio, campanhas, tracking do catálogo, inteligência
  comercial, afiliados.
- **Integrações de estoque** — Nuvemshop (dona do estoque, casamento só por SKU)
  e Jueri (sync 2x/dia).
- **Super Admin** — provisionar lojas, cobrança, uso, suspender, impersonar.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento (Turbopack) |
| `npm test` | Roda os 106 arquivos de teste |
| `npm run build` | Guard de crons + build de produção |
| `npm run db:deploy` | Aplica as migrações (seguro, não apaga dados) |
| `npm run db:seed` | 🚫 Zera o banco e cria a loja demo — **só em local** |
| `npm run db:studio` | Interface visual do banco |
| `npm run lint` | ESLint |

## Convenções

- **Comentários e nomes de domínio em português.** O código fala a língua de
  quem usa: `netTotal`, `sellerId`, mas `resolveCancelStock`, `casaCliente`,
  `phoneMatchVariants`. Comentário explica **por quê**, não o quê.
- **TypeScript sem escapatória.** Hoje há **zero** `: any` e **um** `@ts-ignore`
  em 118 mil linhas. Mantenha assim — é o que segura quem ainda não conhece o
  sistema.
- **Toda rota valida com Zod** e resolve o usuário antes de tocar no banco.
- **Teste que guarda regra tem nome de regra** (`reserva-sem-prazo.test.ts`,
  `pedido-nao-duplica.test.ts`). Ao consertar um bug de negócio, deixe o teste.
