# VestiCRM

CRM SaaS para lojas de roupas, confecções, atacados, boutiques e revendedoras — com foco em **vendas pelo WhatsApp**, organização comercial e aumento de recompra.

## Funcionalidades

### Inteligência Comercial (Tracking Engine)

- **Tracking Engine** (`src/lib/tracking/`) — camada única de eventos: nenhuma tela grava tracking direto; o catálogo envia lotes para `/api/track` (sendBeacon/keepalive, sempre em background — nunca atrasa o carregamento) e todos os relatórios leem via `insights.ts` / `GET /api/intelligence`.
- **Links inteligentes + QR Codes** — `vesticrm.com/c/{loja}?ref=julia` (vendedor), `?ref=campanha-verao` (campanha), `?ref=qr-vitrine` (loja física). Cada link vira QR Code (SVG para baixar/imprimir) e cada clique registra canal, campanha, vendedor, device/OS/navegador, cidade/UF, referer, UTM completa e IP mascarado.
- **Jornada completa** — sessão liga toda a navegação: entrou → viu categoria → viu produto → escolheu cor/tamanho → adicionou → removeu → abriu sacola → enviou pedido → virou lead → comprou. Visitante **anônimo** é criado na hora e **unificado** ao cliente quando informa o telefone.
- **Dashboard estilo analytics** (`/inteligencia`) — visitantes, sessões, tempo médio, conversão, faturamento, ticket, novos/recorrentes, carrinhos abandonados, com comparativo vs. período anterior (▲▼).
- **Funil comercial** — Visitas → Viram produtos → Adicionaram → Carrinho → Pedido → CRM → Compra → Recompra.
- **Rankings** — canais (Instagram, Google, GMB, Facebook, WhatsApp, QR, direto, indicação, loja física, marketplace, campanhas), vendedores (cliques/pedidos/conversão/faturamento/ticket/tempo até venda) e campanhas (cliques/pedidos/ROI vs. meta).
- **Produtos, categorias, cores e tamanhos** — mais vistos, mais vendidos, mais adicionados/removidos, conversão e abandono.
- **Heatmaps** dia × hora (acessos e vendas) e **comparativos** de período (hoje/7/30/90 dias/1 ano).
- **Recuperação comercial** — detecta automaticamente carrinho abandonado, cliente quase comprando e cliente que voltou, com link direto para a ficha. **Alertas inteligentes** ("X foi muito visto e pouco vendido", "Cor Y converte 42%").
- **Exportação CSV** (Excel) por relatório; **LGPD** com banner de consentimento, IP mascarado e isolamento total por empresa.
- **Estrutura preparada** (sem integrar): Meta Pixel, GA4, Google/TikTok Ads e GTM (`destinations.ts`) e **replay de sessão** (`replay.ts` + campo `replayId`).

### Communication Engine (camada omnichannel)

- **Camada única de comunicação** (`src/lib/comm/`) — nenhuma tela fala com provedor: envio, recebimento, anexos, status, recibos e logs passam pela engine. Trocar Mock ↔ Cloud API é uma configuração; nenhuma tela muda.
- **Providers plugáveis** — Mock (funcional, simulado), WhatsApp Cloud API (estrutura pronta, incl. verificação de webhook `hub.challenge` da Meta), Instagram Direct, Facebook Messenger, Telegram, E-mail (SMTP) e SMS (interfaces).
- **Mensagens ricas** — texto, imagem, áudio, documento, vídeo, template, reação e resposta; ID externo (`wamid`); status Enviando → Enviada → Entregue → Lida (ticks no chat), Falhou com erro + botão Reenviar.
- **Conversas** — canal, prioridade (baixa/normal/alta), tempo aberto, tempo aguardando cliente e aguardando vendedor.
- **Templates por categoria** — primeiro atendimento, catálogo, cobrança, pós-venda, recompra, promoção, cliente frio, aniversário.
- **Central de Comunicação** (`/comunicacao`) — monitor de filas, falhas, latência e webhooks com log completo (payload, resposta, tentativas) + **simulador** de todos os cenários (mensagem/imagem/áudio/documento recebidos, envio, erro, recibos de entrega/leitura, webhook com erro).
- **Credenciais seguras** (Configurações → Comunicação) — Meta App ID/Secret, Business Manager, Phone Number ID, Verify Token, Access Token, Webhook Secret, Instagram, Facebook, Telegram e SMTP. Valores sensíveis criptografados em repouso (AES-256-GCM), sempre mascarados na API, com **auditoria** de quem alterou o quê.

### Central Inteligente de Entrada de Leads (omnichannel)

- **Lead Intake Engine** (`src/lib/intake.ts`) — camada única por onde TODA entrada passa (nenhum canal cria clientes diretamente): deduplica por telefone, cria/reaproveita cliente e conversa, gera oportunidade na etapa configurada, cria tarefa de primeiro atendimento dentro do SLA e registra tudo na timeline.
- **14 origens rastreadas** — WhatsApp, Catálogo Público, Instagram, Facebook, Site, Nuvemshop, Bling, Marketplace, Indicação, Loja física, Tráfego pago, Google, Evento e Cadastro Manual.
- **Webhooks prontos** — `POST /api/whatsapp/webhook` (mensagens recebidas) e `POST /api/intake/{canal}` (instagram, facebook, site, nuvemshop, bling, marketplace, google, catalogo). Proteja com `INTAKE_SECRET` (header `x-intake-token`).
- **Distribuição automática** — rodízio entre vendedores (round robin) ou vendedor fixo, configurável por loja.
- **Configuração por origem** — cada origem pode iniciar em uma etapa diferente do funil; política de nova oportunidade (sempre / só sem negociação aberta / nunca); SLA do 1º atendimento em minutos.
- **Timeline do cliente** — "Lead criado via WhatsApp", "Nova interação via Site"... visível na ficha do cliente.
- **Relatórios por canal** — leads por origem, conversão por origem, ticket médio e valor vendido por canal, melhor canal, tempo médio até a 1ª resposta e até a venda.
- O pedido enviado no catálogo público também entra no CRM automaticamente (origem Catálogo Público).

### Catálogo 100% personalizável pelo lojista

- **Identidade visual** (Configurações → Personalizar catálogo): upload do logo da marca, paleta de 3 cores editáveis (com presets Terra/Noir/Rosé/Oliva/Oceano/Lavanda), tipografia (Montserrat, Inter, Poppins, Playfair Display ou Lora) e prévia ao vivo — tudo refletindo na hora no catálogo público.
- **Cores próprias**: o lojista cria a tonalidade (color picker) e dá o nome ("Rosa Millennial") — vira swatch nos produtos e opção da grade.
- **Tamanhos próprios**: P/M/G/GG, numeração ou o que fizer sentido para a loja.
- **Controle total dos produtos**: adicionar, editar e **remover** produtos; foto por **upload do computador/celular** (redimensionada no navegador); grade gerenciável (adicionar/remover combinações cor × tamanho); estoque por variação com ajustes auditados; ativar/desativar.
- **Esgotado automático**: quando todas as variações de uma cor zeram, a foto fica **acinzentada com o selo "Indisponível"** no catálogo.

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

Requer um **PostgreSQL**. Em ambiente efêmero/local, `bash scripts/dev-postgres.sh`
sobe um Postgres pronto e imprime o `DATABASE_URL`.

```bash
npm install
cp .env.example .env        # defina DATABASE_URL (Postgres) e AUTH_SECRET
npm run db:deploy           # aplica as migrações (prisma migrate deploy)
npm run db:seed             # dados de demonstração (NÃO usar em produção)
npm run dev                 # http://localhost:3000
npm test                    # testes unitários (vitest)
```

Para produção, veja **[docs/PRODUCAO.md](docs/PRODUCAO.md)**.

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

- **Banco**: PostgreSQL (dev e produção), com schema versionado por `prisma migrate`.
- **Integrações futuras** (WhatsApp API, Bling, Nuvemshop, Shopify, Instagram, Meta Ads, pagamento, e-mail): a interface `WhatsAppProvider` mostra o padrão — o app fala com abstrações, nunca com o fornecedor direto.
- **Responsivo**: sidebar no desktop, menu drawer + bottom nav no celular; a central de WhatsApp vira lista → conversa em tela cheia no mobile.
