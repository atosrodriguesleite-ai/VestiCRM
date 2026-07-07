# VestiCRM

CRM SaaS para lojas de roupas, confecções, atacados, boutiques e revendedoras — com foco em **vendas pelo WhatsApp**, organização comercial e aumento de recompra.

## Funcionalidades

### Central Inteligente de Entrada de Leads (omnichannel)

- **Lead Intake Engine** (`src/lib/intake.ts`) — camada única por onde TODA entrada passa (nenhum canal cria clientes diretamente): deduplica por telefone, cria/reaproveita cliente e conversa, gera oportunidade na etapa configurada, cria tarefa de primeiro atendimento dentro do SLA e registra tudo na timeline.
- **14 origens rastreadas** — WhatsApp, Catálogo Público, Instagram, Facebook, Site, Nuvemshop, Bling, Marketplace, Indicação, Loja física, Tráfego pago, Google, Evento e Cadastro Manual.
- **Webhooks prontos** — `POST /api/whatsapp/webhook` (mensagens recebidas) e `POST /api/intake/{canal}` (instagram, facebook, site, nuvemshop, bling, marketplace, google, catalogo). Proteja com `INTAKE_SECRET` (header `x-intake-token`).
- **Distribuição automática** — rodízio entre vendedores (round robin) ou vendedor fixo, configurável por loja.
- **Configuração por origem** — cada origem pode iniciar em uma etapa diferente do funil; política de nova oportunidade (sempre / só sem negociação aberta / nunca); SLA do 1º atendimento em minutos.
- **Timeline do cliente** — "Lead criado via WhatsApp", "Nova interação via Site"... visível na ficha do cliente.
- **Relatórios por canal** — leads por origem, conversão por origem, ticket médio e valor vendido por canal, melhor canal, tempo médio até a 1ª resposta e até a venda.
- O pedido enviado no catálogo público também entra no CRM automaticamente (origem Catálogo Público).

### Catálogo + Pedidos

- **Produtos** — catálogo por empresa com SKU, categoria, marca, coleção, descrição, fotos, vídeo, grade cor × tamanho com estoque por variação, preço de custo/atacado/varejo, quantidade mínima, tags e status. Filtros por categoria, cor, tamanho, coleção, marca, preço e estoque.
- **Pedido direto da conversa** — botão de sacola no chat do WhatsApp abre o catálogo em um modal: busca, escolhe cor/tamanho/quantidade e monta o carrinho sem sair da conversa. Preço de atacado é aplicado automaticamente para clientes atacado ou ao atingir a quantidade mínima.
- **Carrinho lateral** — foto, variação, quantidade, subtotal, desconto, frete, observações e forma de pagamento; fecha como orçamento ou pedido.
- **Pedidos** — numeração sequencial por loja e fluxo Orçamento → Aguardando pagamento → Pago → Em produção → Separação → Enviado → Entregue (ou Cancelado), com timeline de eventos, pagamento, rastreio e devolução automática de estoque no cancelamento. Marcar como Pago registra a venda no CRM e atualiza a última compra do cliente.
- **Timeline integrada** — o pedido aparece na conversa (nota automática), na ficha do cliente e no dashboard (pedidos do dia/semana/mês, valor médio, produtos mais vendidos, clientes que mais compram e taxa de recompra).
- **Orçamento em PDF** — gerado com pdf-lib: logo tipográfica da loja, itens, totais e bloco PIX com payload BR Code (copia e cola) pronto para virar QR quando a loja configurar a chave (`src/lib/pix.ts`).
- **Estoque** — toda entrada/saída vira um `InventoryMovement` auditável; criar pedido reserva estoque, cancelar devolve.
- **Integrações futuras** — contratos `CatalogSyncProvider` para Bling, Nuvemshop e Shopify em `src/lib/integrations/catalog.ts` (interfaces prontas, sem implementação).

### CRM

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
npm test                    # testes unitários (vitest)
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
│   ├── orders.ts        # totais/preços/status de pedidos (testado)
│   ├── pix.ts           # payload PIX BR Code + CRC16 (testado)
│   ├── whatsapp.ts      # camada de integração (simulado ↔ Cloud API)
│   ├── integrations/    # contratos Bling/Nuvemshop/Shopify
│   └── __tests__/       # testes unitários (vitest)
└── middleware.ts        # proteção de rotas
prisma/
├── schema.prisma        # 27 modelos multi-tenant (CRM + catálogo/pedidos)
└── seed.ts              # loja demo completa (clientes, produtos e pedidos)
```

- **Banco**: SQLite em desenvolvimento; para produção troque o `provider` do datasource para `postgresql` — o schema é compatível.
- **Integrações futuras** (WhatsApp API, Bling, Nuvemshop, Shopify, Instagram, Meta Ads, pagamento, e-mail): a interface `WhatsAppProvider` mostra o padrão — o app fala com abstrações, nunca com o fornecedor direto.
- **Responsivo**: sidebar no desktop, menu drawer + bottom nav no celular; a central de WhatsApp vira lista → conversa em tela cheia no mobile.
