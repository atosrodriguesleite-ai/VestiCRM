# AtacadoPro (codinome do repo: VestiCRM)

SaaS multi-tenant de CRM + vendas para **moda no atacado** (confecções e
lojistas brasileiros). **EM PRODUÇÃO** em www.atacadopro.com, com lojas reais
pagantes (ex.: Toque Leve, Entre Linhas) e a própria empresa-plataforma usando
o sistema para gerir os leads do AtacadoPro.

## Quem usa e como trabalhar

- O dono (Atos) **não é técnico**: toda comunicação em **português simples**,
  com emojis, passo a passo, sem jargão. Explicar sempre "o que" e "por quê".
- Deploy é **automático a cada push** na branch `claude/modacrm-clothing-crm-cxa9gf`
  (~2-3 min, Vercel). Push = produção. Sempre rodar build + testes antes.
- Trabalhar em entregas pequenas e completas (schema → API → tela → teste →
  push), comunicando em linguagem de negócio.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript + Tailwind 4
- **Prisma 6** + PostgreSQL (Neon em produção; local na porta **5433**,
  iniciar com `pg_ctl -D /var/lib/postgresql/vesti -o "-p 5433"`)
- Vitest (`npm test`), build com guard de crons (`npm run build`)
- Hospedagem Vercel (plano Hobby) + domínios: www.atacadopro.com (app/site),
  catalago.net (catálogo público), bio pública em /bio/[slug]

## Regras operacionais CRÍTICAS (já causaram incidentes)

1. **Vercel Hobby: máximo 2 cron jobs, ambos diários.** Um 3º cron (ou cron
   não-diário) **bloqueia TODOS os deploys silenciosamente**. O guard
   `scripts/check-vercel-crons.mjs` roda no build e falha se violar.
2. **Migrações são escritas à mão** (`prisma/migrations/`) — o banco tem
   drift; `prisma migrate dev` gera lixo (ex.: ALTER do default de
   `Customer.linkCode`, que deve ser REMOVIDO de qualquer diff). Produção
   aplica via `vercel-build` (`prisma migrate deploy`).
3. **NUNCA rodar `db:seed` em produção** (zera/duplica dados de lojas reais).
4. Fotos e mídias ficam como **data-URL no banco** (servidas por
   `/api/img/[id]` com cache). Funciona, mas é a dívida técnica nº 1 —
   migração para blob storage está planejada.
5. Segredos NUNCA no chat/commits. Credenciais ficam na Vercel (env) ou
   criptografadas no banco (AES-256-GCM em `lib/crypto.ts`).

## Arquitetura (mapa mental)

```
src/app/(app)/…        telas autenticadas (Dashboard, Funil, WhatsApp, Pedidos…)
src/app/api/…          ~130 rotas REST (validação Zod, requireUser)
src/app/catalogo/…     catálogo público (sem login)
src/app/bio/[slug]     bio pública (linktree próprio)
src/lib/…              43 motores de negócio (toda regra vive aqui)
prisma/schema.prisma   modelo de dados (comentado em PT-BR)
```

- **Multi-tenant por `companyId` em TODA query** — filtros centralizados em
  `src/lib/scope.ts`. Nenhuma loja enxerga dados de outra.
- **Papéis**: SUPERADMIN (plataforma), ADMIN, MANAGER, SELLER (só a própria
  carteira), SUPPORT (operacional, sem poderes comerciais).
- Auth: JWT em cookie httpOnly (`lib/auth.ts`); Super Admin pode "acessar
  como loja" (impersonação com faixa amarela).
- Comentários de código em **português**, explicando o porquê das regras.

## Regras de negócio centrais (fonte da verdade)

- **Venda = pedido (`Order`) com status em `PAID_ORDER_STATUSES`**
  `[PAGO, EM_PRODUCAO, SEPARACAO, ENVIADO, ENTREGUE]` (lib/orders.ts).
  TODA métrica de faturamento soma por aí (Dashboard, Relatórios,
  Inteligência, Comissões, Equipe, exportações, segmentos). O modelo `Sale`
  é legado do fluxo manual — **não usar para métricas**.
  **Faturamento soma `netTotal` (valor vendido), NUNCA `total`** (que tem
  frete e serve só para cobrar). O guarda é `faturamento-data.test.ts`:
  varredura ampla das telas de dinheiro por `_sum/select/orderBy/+ .total`.
  Uso legítimo de `total` (contas a receber = o que a cliente paga) se
  declara com o marcador **`frete-ok`** e o motivo, na linha ou nas duas
  acima. A versão anterior do guarda tinha regex frouxa e deixou passar seis
  somas com frete no Dashboard — guarda que não pega nada é pior que nenhum.
- **Estoque**: orçamento RESERVA (todos os status exceto CANCELADO seguram
  estoque) — vale para o pedido montado no sistema E para o do catálogo
  público (`lib/reservations.ts`, baixa condicionada: nunca negativa, nunca
  duas vendas da mesma peça). **A reserva NÃO tem prazo**: a peça só volta ao
  estoque quando o pedido é CANCELADO (a soltura automática em 48h foi
  removida). A tela do pedido avisa quantas peças estão seguradas. Baixa
  definitiva/devolução conforme transição de status. Integrações donas de
  estoque (Nuvemshop) espelham — uma venda, uma baixa.
- **Comissão e painel de pedidos** (`Order.sellerId`): pedido montado no
  sistema → quem montou; pedido do catálogo público → **QUEM MANDOU O LINK
  LEVA A VENDA, e SÓ ele** (`?ref=`) — a cliente chega no WhatsApp, a
  vendedora manda o link dela, a cliente pede: o pedido é dessa vendedora, e a
  **carteira acompanha** (`Customer.ownerId` passa a ser dela, com registro na
  linha do tempo). **Sem vendedora no link, o pedido nasce SEM DONA (é da
  loja)** — não existe desvio para a responsável pela cliente: era ele que
  fazia pedido do link da Lara cair no painel da Juliana. Nuvemshop → sem
  vendedor. Pedido só vira PAGO com vendedor (é o que obriga a loja a definir
  a dona antes de faturar); troca de vendedor é auditada em `OrderEvent`.
- **Visibilidade de pedidos** (`orderScope` em `lib/scope.ts`): vendedora vê
  SÓ os pedidos dela (`sellerId`); gerente/admin/suporte veem a loja inteira.
  Vale em toda porta: lista, ficha, PDFs, Pix, NF-e, frete, transferência,
  declaração e exportação.
- **Leads**: entrada única pelo `lib/intake.ts` (Lead Intake Engine) —
  dedup por telefone **tolerante ao 9º dígito** (`phoneMatchVariants`),
  distribuição round-robin/fixa, conversa nasce NA FILA (sem dono; modelo
  Digisac), oportunidade conforme política da loja.
- **Catálogo público**: preço/total SEMPRE recalculado no servidor; links
  rastreados `?ref=` (vendedora) e `?c=` (cliente) alimentam a atribuição.
- **O pedido do catálogo NÃO PODE SE PERDER** (`lib/catalogo/envio-pedido.ts`):
  o aparelho sorteia um protocolo (`Order.clientRef`, único por loja),
  guarda o pedido antes de mandar, INSISTE se falhar e reenvia na próxima
  visita; a rota é idempotente (devolve o pedido existente, e a corrida cai
  no índice único → P2002 tratado). A cliente vê o recibo do registro na
  tela. Já causou incidente real: `.catch(() => {})` engolia a falha, a
  mensagem chegava no WhatsApp da vendedora e o pedido não existia.
  Todo pedido do catálogo AVISA na hora (`notifyNovoPedido`): com vendedora
  no link, só ela; sem vendedora, gerência/admin (nunca uma vendedora
  qualquer — a separação por link vale também para o aviso).
  Resgate manual: **"Colar pedido do WhatsApp"** na tela Pedidos
  (`lib/catalogo/ler-mensagem.ts` + `/api/orders/ler-mensagem`) — lê a
  mensagem do catálogo, casa com o catálogo da loja (nome mais longo vence
  ao separar produto/cor), **preço SEMPRE do nosso cadastro**, prévia sem
  gravar nada e criação pelo caminho normal (`POST /api/orders`). Serve para
  a venda que só existe na conversa; linha sem cadastro ou sem estoque fica
  de fora e é anotada no pedido.

## Módulos

- **CRM**: clientes (carteira), funil de vendas, tarefas, automações,
  campanhas de disparo, tags/interesses, notificações (sino + push PWA).
- **Central de Atendimento WhatsApp** (`/whatsapp`, tela `inbox.tsx`):
  fila/chats/contatos, setores, assumir/transferir/encerrar, notas internas
  com @menção, respostas rápidas (criáveis por qualquer um), mídia + áudio
  (gravação convertida no servidor), pedidos dentro do chat (com PDF enviado
  de verdade), **sync incremental a cada 4s** (`GET /api/conversations?since=`
  + `Conversation.updatedAt`), envio otimista (bolha instantânea ⏱️→✓),
  **marcar conversa como não lida** ("volto nessa depois" — fecha o
  chat junto, senão o sync zeraria o marcador),
  recibos com horário (entregue/visto), editar (15min) e apagar para todos
  (~2 dias), detecção de "cliente apagou" (conteúdo preservado), mensagens
  automáticas personalizáveis (link do catálogo e confirmação de pedido, em
  `CommSettings`), unificação de contatos duplicados, importação de
  histórico de 30 dias (depende do servidor Evolution guardar histórico),
  **foto de perfil das clientes** (`lib/comm/fotos.ts`: guarda só o LINK do
  WhatsApp — nunca a imagem —, revalida a cada 7 dias, busca em lote com teto
  por rodada e cai nas iniciais coloridas quando a cliente esconde a foto ou
  o link vence).
- **Communication Engine** (`lib/comm/`): camada única de envio/recebimento,
  agnóstica de provedor. `EvolutionProvider` = WhatsApp NÃO-oficial via
  Evolution API **self-hosted** (VPS Hostinger srv1853369.hstgr.cloud,
  projeto Docker `evolução-api-2zk0`; envs `EVOLUTION_URL`/`EVOLUTION_KEY`
  na Vercel; webhook autenticado por token único por loja). Anti-ban:
  resposta em janela de 24h sai na hora; envio proativo com ritmo humano
  4-9s; termo de aceite obrigatório registrado. `CloudApiProvider` (Meta
  oficial) pronto na estrutura. Tudo logado em `CommEvent` (Central de
  Comunicação).
- **Integrações de produto/estoque**: **Nuvemshop** (OAuth com state
  assinado, webhooks HMAC; a Nuvemshop é a DONA do estoque; casamento de
  produtos SÓ por SKU; venda paga → `ingestPaidOrder` cria Order PAGO
  direto); **Jueri** (sync 2x/dia via cron `jueri-sync`).
- **Marketing**: Gestor de Bio (temas, cores custom, capa, QR, métricas
  BioView/BioClick com filtro de data, atribuição `utm_source=bio` no
  catálogo), campanhas de aquisição, tracking do catálogo
  (TrackSession/TrackEvent + `lib/tracking/insights.ts` → tela
  Inteligência), afiliados (só empresa-plataforma). Anúncio → campanha
  (`lib/ad-match.ts`): a prévia do Click-to-WhatsApp vira código estável
  (`adRef`) e o vínculo pode ser feito **direto do chat** (bloco "Veio de
  anúncio" na ficha do contato, gerente+). O vínculo é RETROATIVO para quem
  está sem campanha, NUNCA reescreve quem já tem (vale o primeiro contato), e
  um anúncio só pode ter UMA campanha dona.
- **Produção** (gated por loja): tecidos, rolos, cortes multi-cor, costura,
  lotes/facções, defeitos, simulador, etiquetas.
- **Envios** (gated por loja, `shippingEnabled`, pago à parte): Melhor Envio
  OAuth por loja (`lib/melhorenvio.ts`); peso por produto (sync automático da
  Nuvemshop, nunca sobrescreve manual) + padrão por categoria/loja; no pedido:
  cotar → comprar etiqueta (saldo da carteira ME da loja; gerente+) → imprimir
  etiqueta + declaração de conteúdo (`/declaracao/[id]`) + rastreio (msg
  WhatsApp pronta). Cancelamento antes da postagem devolve o valor.
- **Super Admin**: painel Lojas (provisionar, cobrança, uso, suspender,
  impersonar), diagnóstico de fotos; loja demo "Bella Moda".

## Estado atual e pendências conhecidas

- WhatsApp/Evolution: operacional em produção (conexão, tempo real, mídia).
  **Pendente**: ligar `DATABASE_SAVE_DATA_HISTORIC/NEW_MESSAGE/CHATS/CONTACTS=true`
  no compose do servidor Evolution (Hostinger, via Editor .yaml) e reconectar
  as lojas — sem isso a importação de histórico devolve ~0 mensagens.
- **Monitoramento** (25/07/2026): vigia em `lib/health.ts` roda de carona no
  tráfego (SEM cron novo!) — checa servidor Evolution + conexão por loja,
  alerta sino/push com anti-spam; erros de produção capturados por
  `src/instrumentation.ts` (onRequestError) → painel `/saude` (Super Admin).
- **Dinheiro** (25/07/2026): Mercado Pago marketplace (Pix com confirmação
  automática via `lib/settle-order.ts`; taxa da plataforma 0,5% em
  `PLATFORM_FEE_PCT`/`feePercent` por loja), tela Financeiro (contas a
  receber) e NF-e via Bling (`lib/bling.ts`). PENDENTE para produção:
  criar app no Mercado Pago (envs `MP_CLIENT_ID`/`MP_CLIENT_SECRET`) e app
  no Bling (`BLING_CLIENT_ID`/`BLING_CLIENT_SECRET`) na Vercel.
- **Envios** (25/07/2026): módulo completo no código. PENDENTE para produção:
  criar app em melhorenvio.com.br (redirect
  `https://www.atacadopro.com/api/melhorenvio/callback`) e envs
  `MELHOR_ENVIO_CLIENT_ID`/`MELHOR_ENVIO_CLIENT_SECRET` na Vercel; ligar a
  chave por loja no painel Lojas. Parceria/comissão ME em negociação à parte.
- Dívidas mapeadas: blob storage para fotos; rate-limit no login;
  conferir `INTAKE_SECRET` na Vercel; quebrar telas gigantes
  (`inbox.tsx` ~2,4k linhas) em componentes menores.
- Auditoria completa (segurança + métricas) feita em 24/07/2026 — métricas
  unificadas na fonte única; isolamento multi-tenant verificado rota a rota.
