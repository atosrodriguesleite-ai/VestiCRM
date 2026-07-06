# VestiCRM

CRM SaaS para lojas de roupas, confecções, atacados, boutiques e revendedoras — com foco em **vendas pelo WhatsApp**, organização comercial e aumento de recompra.

## Funcionalidades

- **Dashboard** — vendas, ticket médio, taxa de conversão, funil aberto, clientes esfriando, follow-ups atrasados, ranking de vendedores e produtos mais procurados.
- **Funil de vendas visual** — kanban com cards arrastáveis (Novo lead → Primeiro contato → Interesse → Catálogo enviado → Negociação → Pagamento pendente → Fechado → Pós-venda → Perdido). Mover para "Pedido fechado" registra a venda automaticamente; mover para "Perdido" pede o motivo.
- **Central de WhatsApp** — caixa de entrada com filtros por status (aberta, aguardando cliente, aguardando pagamento, finalizada), histórico completo, modelos de mensagem com variáveis (`{{nome}}`, `{{vendedora}}`), notas internas, transferência entre vendedores e registro automático no perfil do cliente. Roda em **modo simulado** com camada de integração pronta para a WhatsApp Cloud API (`src/lib/whatsapp.ts`).
- **Clientes** — ficha completa: tipo (varejo/atacado/revendedora/lojista/boutique/sacoleira), origem, tags, interesses, tamanho e cores preferidas, histórico de compras, conversas e tarefas.
- **Tarefas e follow-up** — ligar, enviar catálogo, cobrar pagamento, pós-venda, reativação... com data, hora, prioridade, responsável e alertas de atraso no dashboard.
- **Automação comercial** — 6 regras que vigiam a carteira (cliente sem resposta há 2 dias, catálogo sem retorno, recompra após 30 dias, reativação de perdidos, primeiro contato de lead novo, pós-venda de pedido fechado) e viram tarefa com um clique.
- **Campanhas de reativação** — segmentação por inatividade (30/60/90 dias), tipo de cliente, cidade, ticket, interesse, tag e negociações abandonadas, com prévia de alcance ao vivo.
- **Relatórios** — vendas por semana, por vendedor, funil por etapa, motivos de perda, origem dos clientes, clientes mais valiosos, inativos, tempo médio de fechamento e produtos mais desejados.
- **Equipe e permissões** — papéis Admin / Gerente / Vendedor(a) / Atendimento. Vendedor vê apenas a própria carteira; gerente vê o time; admin gerencia usuários.
- **Multi-empresa (SaaS)** — todo dado carrega `companyId`; nenhuma loja acessa dados de outra (ver `src/lib/scope.ts`). Papel `SUPERADMIN` reservado para a operação da plataforma.

## Rodando o projeto

```bash
npm install
cp .env.example .env        # ajuste AUTH_SECRET em produção
npx prisma db push          # cria o SQLite local
npm run db:seed             # dados de demonstração
npm run dev                 # http://localhost:3000
```

### Logins de demonstração (senha `demo1234`)

| E-mail | Papel |
|---|---|
| `ana@bellamoda.com.br` | Administradora |
| `carla@bellamoda.com.br` | Gerente |
| `julia@bellamoda.com.br` | Vendedora (vê só a própria carteira) |
| `renata@bellamoda.com.br` | Vendedora |
| `marcos@urbanstyle.com.br` | Admin de **outra empresa** (prova o isolamento multi-tenant) |

## Arquitetura

```
src/
├── app/
│   ├── (app)/           # páginas autenticadas (dashboard, funil, whatsapp, ...)
│   ├── api/             # rotas REST (auth, customers, opportunities, ...)
│   └── login/
├── components/          # AppShell (sidebar/bottom-nav), UI, gráficos SVG
├── lib/
│   ├── auth.ts          # sessão JWT (cookie httpOnly, 7 dias)
│   ├── scope.ts         # regras de visibilidade multi-tenant + papéis
│   ├── automations.ts   # motor de sugestões comerciais
│   ├── segments.ts      # segmentação de campanhas
│   └── whatsapp.ts      # camada de integração (simulado ↔ Cloud API)
└── middleware.ts        # proteção de rotas
prisma/
├── schema.prisma        # 18 modelos multi-tenant
└── seed.ts              # loja demo completa
```

- **Banco**: SQLite em desenvolvimento; para produção troque o `provider` do datasource para `postgresql` — o schema é compatível.
- **Integrações futuras** (WhatsApp API, Bling, Nuvemshop, Shopify, Instagram, Meta Ads, pagamento, e-mail): a interface `WhatsAppProvider` mostra o padrão — o app fala com abstrações, nunca com o fornecedor direto.
- **Responsivo**: sidebar no desktop, menu drawer + bottom nav no celular; a central de WhatsApp vira lista → conversa em tela cheia no mobile.
