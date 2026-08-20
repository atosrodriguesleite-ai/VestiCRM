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
- **REVISÃO OBRIGATÓRIA ANTES DO PUSH** (pedido do dono, 09/08/2026): toda
  entrega de código passa pela revisão especialista (`/code-review`, nível
  high) ANTES de subir; corrigir os achados confirmados e só então push.
  Motivo real: a revisão da conferência de tarefas achou 10 bugs num código
  já "pronto" — 3 deles esconderiam dinheiro pendente. Casos de canto (dois
  pedidos, compromisso futuro, status raro) são exatamente o que o autor não
  vê. Exceção: mudança trivial sem lógica (texto, cor, label).
- Quando a mudança mexe com **dinheiro, estoque ou apagar/concluir dados
  sozinha**, além da revisão: reproduzir o cenário ponta a ponta contra o
  Postgres local antes de subir (adivinhar já errou 3 vezes num dia).

## Como usar a documentação (`/docs`)

A documentação **faz parte do desenvolvimento**, não é enfeite. A régua da
pasta `/docs`: um documento só existe se alguma coisa quebra sem ele — o que o
código responde sozinho não vira documento (doc desatualizada é pior que doc
nenhuma, porque quem lê confia nela).

**Onde cada resposta mora:**

| Pergunta | Onde |
|---|---|
| Qual a regra? | este arquivo, marcada com **RN-0XX** |
| Que número tem a regra? | `docs/regras.md` (índice: ID → onde vive → qual teste guarda) |
| **Por que** foi feito assim? | `docs/decisoes/` — **ADR-0XX** |
| Como sabemos que funciona? | os testes (`npm test`) |
| Quais contas/chaves externas? | `docs/integracoes.md` |
| Deu problema em produção? | `docs/runbook.md` |
| E o jurídico/LGPD? | `docs/juridico/` |

**Protocolo de toda entrega:**

1. Antes de implementar, localizar as **RN** e os **ADR** que a mudança toca
   (`docs/regras.md` e `docs/decisoes/README.md`).
2. Implementar, criando/ajustando os testes que guardam a regra.
3. **Atualizar a documentação afetada no mesmo commit.** Mudou o comportamento
   de uma RN? O texto dela aqui muda junto. Foi uma decisão nova que restringe
   o futuro? Nasce um ADR.
4. Dizer no fim quais IDs foram tocados (ex.: *"implementa RN-016, ADR-011"*).

**Regra dos números:** nunca reaproveitar, nunca renumerar. Regra ou decisão
que morre vira `revogada em MM/AAAA, substituída por RN-0YY` — some do
sistema, fica no histórico.

Toda RN vive em **três lugares**: o texto aqui, a linha no índice e o marcador
`// Guarda RN-0XX` dentro do teste que a defende. O `docs-regras.test.ts` roda
dentro do `npm run build` (`check:docs`) e **derruba o build** se os três
discordarem — inclusive se o teste citado como guardião não declarar a regra.

## Stack

- **Next.js 15** (App Router) + React 19 + TypeScript + Tailwind 4
- **Prisma 6** + PostgreSQL (Neon em produção; local na porta **5433**,
  iniciar com `pg_ctl -D /var/lib/postgresql/vesti -o "-p 5433"`)
- Vitest (`npm test`); `npm run build` roda dois guardas antes de compilar:
  crons (`check-vercel-crons.mjs`) e documentação (`check:docs`)
- Hospedagem Vercel (conta Pro; o limite de 2 crons é mantido de propósito,
  ver ADR-002) + domínios: www.atacadopro.com (app/site),
  catalago.net (catálogo público), bio pública em /bio/[slug]

## Regras operacionais CRÍTICAS (já causaram incidentes)

1. **Máximo 2 cron jobs, ambos diários** (ADR-002). Um 3º cron (ou cron
   não-diário) **bloqueia TODOS os deploys silenciosamente**. O guard
   `scripts/check-vercel-crons.mjs` roda no build e falha se violar. Trabalho
   periódico novo não vira cron: vira motor de carona no tráfego, com trava.
2. **Migrações são escritas à mão** (`prisma/migrations/`, ADR-001) — o banco tem
   drift; `prisma migrate dev` gera lixo (ex.: ALTER do default de
   `Customer.linkCode`, que deve ser REMOVIDO de qualquer diff). Produção
   aplica via `vercel-build` (`prisma migrate deploy`).
3. **NUNCA rodar `db:seed` em produção** (zera/duplica dados de lojas reais).
4. Fotos e mídias ficam como **data-URL no banco** (servidas por
   `/api/img/[id]` com cache). Funciona, mas é a dívida técnica nº 1 —
   migração para blob storage planejada (ADR-003).
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

- **RN-013 · Multi-tenant por `companyId` em TODA query** — filtros centralizados em
  `src/lib/scope.ts`. Nenhuma loja enxerga dados de outra.
- **Papéis**: SUPERADMIN (plataforma), ADMIN, MANAGER, SELLER (só a própria
  carteira), SUPPORT (operacional, sem poderes comerciais).
- Auth: JWT em cookie httpOnly (`lib/auth.ts`); Super Admin pode "acessar
  como loja" (impersonação com faixa amarela).
- Comentários de código em **português**, explicando o porquê das regras.

## Regras de negócio centrais (fonte da verdade)

- **RN-001 · Venda = pedido (`Order`) com status em `PAID_ORDER_STATUSES`**
  `[PAGO, EM_PRODUCAO, SEPARACAO, ENVIADO, ENTREGUE]` (lib/orders.ts).
  TODA métrica de faturamento soma por aí (Dashboard, Relatórios,
  Inteligência, Comissões, Equipe, exportações, segmentos). O modelo `Sale`
  é legado do fluxo manual — **não usar para métricas**.
  **RN-002 · Faturamento soma `netTotal` (valor vendido), NUNCA `total`** (que tem
  frete e serve só para cobrar). O guarda é `faturamento-data.test.ts`:
  varredura ampla das telas de dinheiro por `_sum/select/orderBy/+ .total`.
  Uso legítimo de `total` (contas a receber = o que a cliente paga) se
  declara com o marcador **`frete-ok`** e o motivo, na linha ou nas duas
  acima. A versão anterior do guarda tinha regex frouxa e deixou passar seis
  somas com frete no Dashboard — guarda que não pega nada é pior que nenhum.
- **RN-003 · Estoque**: orçamento RESERVA (todos os status exceto CANCELADO seguram
  estoque) — vale para o pedido montado no sistema E para o do catálogo
  público (`lib/reservations.ts`, baixa condicionada: nunca negativa, nunca
  duas vendas da mesma peça). **A reserva NÃO tem prazo**: a peça só volta ao
  estoque quando o pedido é CANCELADO (a soltura automática em 48h foi
  removida). A tela do pedido avisa quantas peças estão seguradas.
  **RN-004** · Ao CANCELAR, o vendedor escolhe: devolver as peças (padrão; o livro de
  movimentos devolve exatamente o que saiu) ou **baixa definitiva**
  (`restock: false` → `Order.stockWrittenOff`; perda/brinde/defeito — nada
  volta, nada é empurrado às integrações). Reabrir pedido baixado NÃO
  desconta de novo (`resolveCancelStock`/`resolveReopenStock` em
  lib/orders.ts). Integrações donas de estoque (Nuvemshop) espelham — uma
  venda, uma baixa.
- **RN-005 · Comissão e painel de pedidos** (`Order.sellerId`): pedido montado no
  sistema → quem montou; pedido do catálogo público → **QUEM MANDOU O LINK
  LEVA A VENDA, e SÓ ele** (`?ref=`) — a cliente chega no WhatsApp, a
  vendedora manda o link dela, a cliente pede: o pedido é dessa vendedora, e a
  **carteira acompanha** (`Customer.ownerId` passa a ser dela, com registro na
  linha do tempo). **Sem vendedora no link, o pedido nasce SEM DONA (é da
  loja)** — não existe desvio para a responsável pela cliente: era ele que
  fazia pedido do link da Lara cair no painel da Juliana. Nuvemshop → sem
  vendedor. **RN-006** · Pedido só vira PAGO com vendedor (é o que obriga a loja
  a definir a dona antes de faturar); troca de vendedor é auditada em `OrderEvent`.
- **RN-007 · Visibilidade de pedidos** (`orderScope` em `lib/scope.ts`): vendedora vê
  SÓ os pedidos dela (`sellerId`); gerente/admin/suporte veem a loja inteira.
  Vale em toda porta: lista, ficha, PDFs, Pix, NF-e, frete, transferência,
  declaração e exportação. **Exceção por pessoa** (17/08/2026): o interruptor
  **"vê todos os pedidos da loja"** na tela Equipe (`User.pedidosVisaoTotal`,
  irmão do `chatVisaoTotal`) abre a área de Pedidos inteira para uma
  vendedora específica — e, desde 18/08/2026 (decisão do dono), ela também
  **EDITA qualquer pedido, com tudo registrado**: cada mexida do PATCH
  (status, valores/frete, itens, envio, forma de pagamento, vendedor,
  cliente) fica no histórico do pedido com quem fez (`OrderEvent`). O que
  segue intocável é a COMISSÃO: transferir venda de colega OU assumir
  pedido sem dona continua proibido (`podeTransferirVenda`; sem dona = da
  loja, gerência define), excluir pedido e comprar etiqueta seguem
  gerência, e a exportação CSV segue o escopo normal.
- **RN-008 · Leads**: entrada única pelo `lib/intake.ts` (Lead Intake Engine) —
  dedup por telefone **tolerante ao 9º dígito** (`phoneMatchVariants`),
  distribuição round-robin/fixa, conversa nasce NA FILA (sem dono; modelo
  Digisac), oportunidade conforme política da loja.
- **RN-009 · Catálogo público**: preço/total SEMPRE recalculado no servidor; links
  rastreados `?ref=` (vendedora) e `?c=` (cliente) alimentam a atribuição.
- **RN-010 · O pedido do catálogo NÃO PODE SE PERDER** (`lib/catalogo/envio-pedido.ts`):
  o aparelho sorteia um protocolo (`Order.clientRef`, único por loja),
  guarda o pedido antes de mandar, INSISTE se falhar e reenvia na próxima
  visita; a rota é idempotente (devolve o pedido existente, e a corrida cai
  no índice único → P2002 tratado). A cliente vê o recibo do registro na
  tela. Já causou incidente real: `.catch(() => {})` engolia a falha, a
  mensagem chegava no WhatsApp da vendedora e o pedido não existia.
  **RN-011** · Todo pedido do catálogo AVISA na hora (`notifyNovoPedido`): com vendedora
  no link, só ela; sem vendedora, gerência/admin (nunca uma vendedora
  qualquer — a separação por link vale também para o aviso).
  **RN-018 · Tabelas de preço por link** (`lib/catalogo/tabelas-de-preco.ts`,
  gated por `Company.priceTablesEnabled`, DESLIGADO por padrão): a loja que
  atende lojista E cliente final gera links do MESMO catálogo com tabelas
  diferentes (`/catalogo/<loja>/l/<código>`, código SORTEADO — o preço de
  atacado não se descobre por tentativa). Quem manda no preço é o servidor: o
  navegador só diz por qual link entrou, e o pedido guarda a tabela que o
  precificou (`Order.priceMode`). No link de ATACADO o mínimo por modelo é
  EXIGIDO (soma todas as cores e tamanhos do mesmo produto). Link que não vale
  mais RECUSA o pedido — nunca cai no varejo em silêncio. **Loja que não ativa
  o recurso não muda em NADA**: mesmo link, mesmo preço, sem trava de mínimo.
  **RN-012** · Resgate manual: **"Colar pedido do WhatsApp"** na tela Pedidos
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
  fila/chats/contatos (vendedora vê os dela + a fila; o interruptor
  **"vê todas as conversas do chat"** na tela Equipe — `User.chatVisaoTotal`,
  `conversationScope` — abre a Central inteira para uma vendedora específica
  SEM mexer em carteira/pedidos/comissão), setores, assumir/transferir/encerrar, notas internas
  com @menção, respostas rápidas (criáveis por qualquer um), mídia + áudio
  (gravação convertida no servidor), pedidos dentro do chat (com PDF enviado
  de verdade), **sync incremental a cada 3s** (`GET /api/conversations?since=`
  + `Conversation.updatedAt`). **PREPARADO PARA MILHARES DE CONVERSAS**: a
  LISTA carrega só a ÚLTIMA mensagem de cada conversa, cortada em 140
  caracteres (pedido do catálogo tem milhares); o histórico vem ao ABRIR a
  conversa (`threadsCarregadas`), e conversa não aberta nunca recebe mensagem
  solta do sync. A tela desenha em blocos de 200 linhas, mas guarda a lista
  INTEIRA (é o que faz contagem de aba e busca serem verdadeiras). Medido em
  2.007 conversas/120 mil mensagens: 4,5 MB e 200 conversas visíveis → 1,75 MB
  e TODAS visíveis.
  **O que o sync entrega é PARCIAL — e isso já causou incidente**: conversa
  que chega por ele vinha com uma mensagem só ("já respondi e aparece como se
  nunca tivesse conversado"). Três portas fecham o buraco: `GET
  /api/conversations/[id]` (conversa inteira, buscada quando a tela não a
  conhece), `GET /api/conversations/[id]/mensagens?antes=` ("Ver mensagens
  anteriores" — sem ela o começo da conversa era INACESSÍVEL) e
  `GET /api/conversations?q=` (busca na loja inteira, `casaCliente` em
  memória por causa do acento — sem ela a lupa só via as 200 carregadas).
  Formato da mensagem em um lugar só (`mapMessage`), envio otimista (bolha instantânea ⏱️→✓),
  **copiar mensagem** (`lib/copiar.ts`, com plano B para navegador
  antigo; vale para a mensagem da CLIENTE — pedido, Pix, endereço),
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
  na Vercel; webhook autenticado por token único por loja). **RN-017** · Anti-ban:
  resposta em janela de 24h sai na hora; envio proativo com ritmo humano
  4-9s; termo de aceite obrigatório registrado (sem aceite, sem QR Code). `CloudApiProvider` (Meta
  oficial) pronto na estrutura. Tudo logado em `CommEvent` (Central de
  Comunicação).
- **Integrações de produto/estoque**: **RN-014 · Nuvemshop** (OAuth com state
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
  um anúncio só pode ter UMA campanha dona (**RN-015**).
- **Produção** (gated por loja): tecidos, rolos, cortes multi-cor, costura,
  lotes/facções, defeitos, simulador, etiquetas.
- **Envios** (gated por loja, `shippingEnabled`, pago à parte): tela própria
  no menu (`/envios`): painel (gasto do mês, aguardando postagem, em
  trânsito com alerta de **parado há 7+ dias**, entregues com tempo médio) +
  lista de tudo que saiu (transportadora, destinatária, rastreio com copiar
  código/link público, status vivo) — a lista respeita RN-007 (`orderScope`)
  e a abertura da tela dá carona na varredura de rastreio. Melhor Envio
  OAuth por loja (`lib/melhorenvio.ts`); peso por produto (sync automático da
  Nuvemshop, nunca sobrescreve manual) + padrão por categoria/loja; no pedido:
  cotar → comprar etiqueta (saldo da carteira ME da loja; gerente+) → imprimir
  etiqueta + rastreio (msg WhatsApp pronta). **Medidas reais do pacote**
  (17/08/2026): a cotação nasce automática (peso das peças + caixa padrão) e a
  lojista pode pesar/medir e recotar — com **vários volumes** (caixa, saco;
  Correios só etiquetam 1) e **valor segurado editável** (com NF-e trava no
  valor das peças) — a compra sai com os MESMOS números da cotação aceita
  (fonte única `volumesDoEnvio`); aviso de **peso suspeito** (dobro/metade do
  calculado, `lib/peso-pacote.ts`). Compra exige cadastro completo do cliente
  (CEP, rua, número, bairro, cidade, UF, telefone e CPF **ou** CNPJ; com
  CNPJ, a Inscrição Estadual — `Customer.stateRegistration` — vai na
  etiqueta). Na ficha, **CEP preenche o endereço sozinho** (ViaCEP). Cancelamento antes da postagem
  devolve o valor. **RN-016** · Pedido com nota AUTORIZADA (Bling) compra a
  etiqueta COM a NF-e (chave de acesso); sem nota, sai com declaração de
  conteúdo (`/declaracao/[id]`). A chave é conferida no Bling ANTES de debitar
  o saldo, e a chave usada fica na própria etiqueta (`Shipping.nfeKey`).
  **RN-019 · Pacote por categoria e simulador de frete**
  (`lib/envios/pacote.ts` + `lib/envios/simulador.ts`): cada categoria guarda
  o peso e as **medidas de 1 peça dobrada**
  (`MelhorEnvioConnection.categoryDims`, tela Configurações → Melhor Envio) e
  o sistema **MONTA o pacote empilhando** — base = maior peça, altura = soma
  das alturas, dividido em volumes acima de 100 cm (teto dos Correios),
  mínimos 16×11×2. Vale na **cotação automática do pedido** (a caixa padrão
  única virou reserva de quem não cadastrou; cotação e compra usam OS MESMOS
  volumes) e no **simulador da tela Envios** (interruptor
  `Company.freteSimuladorEnabled`, DESLIGADO por padrão — a própria loja
  liga, gerente+, com aviso de que é estimativa): categoria + quantidade +
  CEP + valor aproximado, pacote montado NO SERVIDOR. Alternativa do
  simulador: a **memória de embalagem** dos envios reais
  (`Shipping.volumesJson` + `pieces` + `meCompradoEm`, gravados na compra da
  etiqueta) — envios parecidos por nº de peças, e a vendedora escolhe.
  Memória por loja (RN-013); etiqueta cancelada não vira referência;
  categoria sem medidas não muda NADA (caixa padrão, como sempre); loja sem
  o interruptor não vê o simulador.
- **Super Admin**: painel Lojas (provisionar, cobrança, uso, suspender,
  impersonar), diagnóstico de fotos; loja demo "Bella Moda".

## Estado atual e pendências conhecidas

- 🔴 **COMBINADO COM O DONO — `CRED_SECRET` (procedimento NOVO, 16/08/2026).**
  Enquanto este item estiver aqui, **lembrar o Atos no começo da conversa.**
  A variável não existe na Vercel e `src/lib/env.ts` faz a `CRED_SECRET`
  cair na `AUTH_SECRET` — trocar a `AUTH_SECRET` um dia derrubaria as
  integrações de todas as lojas. O plano antigo (copiar o valor) morreu:
  a `AUTH_SECRET` é **Sensitive** na Vercel e não pode ser revelada. Por
  isso o cofre (`lib/crypto.ts`) agora **abre com as duas chaves**: grava
  com a `CRED_SECRET` e, ao ler, cai na `AUTH_SECRET` se preciso (guarda:
  `crypto-troca-chave.test.ts`). O Atos só precisa criar `CRED_SECRET`
  na Vercel com um **valor NOVO aleatório longo (40+ caracteres)** e
  redeployar — nada quebra, e os tokens antigos migram sozinhos conforme
  os OAuth renovam. Apagar este item só depois de o Atos confirmar.
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
- **Envios** (13/08/2026): Melhor Envio **em produção** — app criado, envs na
  Vercel, primeira conta conectada e cotando. Parceria/comissão ME em
  negociação à parte. A etiqueta com NF-e (RN-016) depende do Bling.
- Dívidas mapeadas: blob storage para fotos; rate-limit no login;
  conferir `INTAKE_SECRET` na Vercel; quebrar telas gigantes
  (`inbox.tsx` ~2,4k linhas) em componentes menores.
- Auditoria completa (segurança + métricas) feita em 24/07/2026 — métricas
  unificadas na fonte única; isolamento multi-tenant verificado rota a rota.
