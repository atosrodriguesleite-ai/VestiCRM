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
  fazia pedido do link da Lara cair no painel da Juliana. **Nuvemshop → sem
  vendedor, E ASSIM FICA** (28/08/2026): venda da loja online não gera
  comissão e NÃO ACEITA vendedora — nem admin atribui/transfere
  (`podeTransferirVenda` recusa por `source`; "Editar dados" esconde o campo;
  a lista mostra "loja online" em cinza, sem alerta — sem dona ali é o certo).
  **RN-006** · Pedido só vira PAGO com vendedor (é o que obriga a loja
  a definir a dona antes de faturar); troca de vendedor é auditada em
  `OrderEvent`. Exceção: venda da loja online (nasce paga e sem dona por
  RN-005) — sem ela, pedido Nuvemshop cancelado nunca poderia reabrir.
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
  **RN-020 · Cadastro duplicado por dígito ERRADO** (`lib/contatos-parecidos.ts`):
  o dedup da RN-008 resolve o 9º dígito, mas não tem como resolver número
  digitado errado — para o sistema, `91289574` e `91289575` são duas pessoas,
  e adivinhar juntaria clientes de verdade. Então o sistema **avisa e não
  junta**: ao abrir a conversa, se existir outro cadastro com **nome parecido
  E telefone a um dígito de distância** (mesmo DDD, já ignorando o 9º), o chat
  mostra "parece a mesma pessoa cadastrada 2×" com o link do outro cadastro.
  Exigir as DUAS coisas é o que evita alarme falso (duas "Maria Silva" de
  verdade têm números diferentes; irmãs com números seguidos têm nomes
  diferentes) — e aviso falso em cadastro de cliente faz a loja parar de ler.
  Incidente que criou a regra (Toque Leve, 20/08/2026): a mesma cliente em
  dois cadastros fazia duas vendedoras atenderem metades diferentes do
  assunto, e o que saía pelo número errado ficava no ✓ simples para sempre.
  **RN-021 · No pedido do catálogo por LINK PESSOAL, vale o WhatsApp dela**
  (`lib/catalogo/telefone-do-pedido.ts`): a origem do cadastro duplicado acima
  era o formulário — o telefone DIGITADO sempre mandava, e um dígito errado
  criava cliente novo. Entrando pelo link pessoal (`?c=`), o sistema já sabe
  quem é e aquele número é VERIFICADO (ela está falando dele); o digitado é
  palpite e não inventa mais cadastro. O que ela digitou fica anotado no
  pedido com aviso, para a loja conferir. **Sem link pessoal** (link geral,
  bio, catálogo aberto) nada muda: o digitado é a única informação que existe.
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
  com @menção, respostas rápidas (criáveis por qualquer um), mídia + **áudio
  de voz** (a vendedora **escolhe o microfone** na engrenagem ao lado do botão
  de gravar, `lib/microfone.ts` — antes quem mandava era o padrão do Windows e
  o headset plugado ficava de fora sem ninguém saber; a barra mostra de qual
  microfone o som está vindo, e microfone que sumiu volta ao padrão AVISANDO.
  **O volume é acertado antes de sair** (`normalizarVoz` em `lib/audio-wav.ts`):
  o nível vem da ENERGIA DA FALA — quadros de 20 ms, silêncio fora por
  porteira, mediana em cima (pico e média deixavam um estalo de 200 ms mandar
  no áudio inteiro) — e o que passa do teto encontra um FREIO SUAVE, nunca a
  tesoura: cortar reto é literalmente o barulho de "estourado". A gravação só
  começa depois de `MS_ASSENTAR_MICROFONE` (0,5s), que joga a subida do ganho
  automático para fora do arquivo — era ela o "primeiro segundo estourado".
  `lib/audio-wav.ts`: a gravação vira WAV no NAVEGADOR — o webm do
  MediaRecorder não carrega a duração e o WhatsApp mostrava 0:00 — na MAIOR
  taxa que couber no envio: 24 kHz até ~65s e 16 kHz daí em diante. Com os
  16 kHz fixos de antes, tudo acima de 8 kHz era jogado fora (Nyquist) — e é
  ali que moram o "s" e o "ch": a voz chegava abafada, de telefone. Medido no
  Chromium com a função real: tom de 8 kHz sai ZERADO a 16 kHz e volta
  INTEIRO a 24 kHz. O teto para em 24 kHz de propósito: 32 kHz não melhorou
  nada na medição e só dobraria o peso, que aqui mora como data-URL no banco.
  A decodificação pede 48 kHz explicitamente, senão a taxa vinha do aparelho
  de SAÍDA (fone bluetooth em viva-voz derrubava tudo para 16 kHz). A captura
  usa cancelamento de eco
  DESLIGADO — é gravação, não chamada —, mantendo supressão de ruído e ganho
  automático, que loja barulhenta precisa), **até 20 fotos de uma vez** (a
  vendedora mandava a arara peça por peça; só FOTO aceita várias — vídeo e
  documento pesam 3 MB cada). As fotos saem **uma de cada vez, com 2s de pausa
  entre elas** (`MS_ENTRE_FOTOS`): o envio de mídia é em segundo plano, então
  sem a pausa os vinte sairiam em rajada — o padrão que faz o WhatsApp
  desconfiar da conta (RN-017). A pausa é maior que a subida de uma foto, e
  **na prática** elas chegam na ordem escolhida — não é promessa: ordem
  garantida exigiria segurar o pedido aberto até o envio terminar, que é
  exatamente o que matava a função no meio e fazia a cliente RECEBER DUAS
  VEZES (incidente do áudio). Quem espera é o NAVEGADOR, nunca o servidor.
  Cada foto tem a própria bolha (⏱️ → ✓ ou ⚠️) — e o dedup do sync casa
  **uma bolha para cada mensagem** (todas têm o corpo "📷 Imagem"; sem isso a
  foto anterior apagava a bolha da que estava em voo e o erro dela sumia).
  A barra mostra o andamento na conversa DELA (nas outras o chat segue
  normal), dá para PARAR a fila e três falhas seguidas param sozinhas.
  **A ORDEM das barras do compositor é regra** (incidente 28/08/2026):
  gravação vem ANTES da fila — microfone aberto precisa dos botões de parar
  e enviar. A tentativa de dar prioridade com `recording ? null : …` apagou a
  área INTEIRA ao tocar no microfone (o `null` encerra a cadeia e as barras
  ficam inalcançáveis) e NINGUÉM mandou áudio até o conserto. O teste que
  deveria pegar isso exigia o próprio trecho defeituoso: guarda que descreve
  o CÓDIGO em vez do COMPORTAMENTO protege o erro em vez de impedi-lo. **Foto em alta resolução**
  (`lib/comprimir-foto.ts`): lado maior 2560px (era 1600 — a cliente dá zoom
  para ver trama e acabamento e via borrão), alvo ~2,2 MB com teto duro que
  volta a 1600px se não couber; a codificação usa `toBlob` (o `toDataURL`
  congelava a tela em vinte fotos) e a memória é liberada entre elas
  (`img.close()`, senão o celular derrubava a aba no meio da fila). Medido no
  Chromium: foto de peça 4032×3024 sai 2560×1920 com ~0,2 MB; o pior caso
  (ruído em cada pixel) dá 1,88 MB, dentro do teto do envio. Lembrar da
  dívida nº 1: isso mora como data-URL no banco. Pedidos dentro do chat (com PDF
  enviado de verdade), **sync incremental a cada 3s** (`GET /api/conversations?since=`
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
  **Reagir com emoji** (25/08/2026): o mesmo gesto do aplicativo — o emoji
  fica GRUDADO na mensagem (uma reação de cada lado: `Message.reaction` da
  cliente, `Message.reactionStore` da loja), nunca vira bolha nova. A reação
  da cliente antes chegava como mensagem solta "[reagiu 👍]", sem dizer a QUE
  ela reagiu. Quem separa os dois lados é o `fromMe` do webhook (o WhatsApp
  devolve pelo mesmo caminho o eco da reação feita pela própria loja, inclusive
  a feita no celular dela). Emoji vazio remove. Reagir NÃO reordena a lista.
  **Foto da cliente clicável** no cabeçalho do chat: abre no visor de tela
  cheia (com zoom) — o retrato de 32px não serve para reconhecer ninguém.
  Formato da mensagem em um lugar só (`mapMessage`), envio otimista (bolha instantânea ⏱️→✓),
  **copiar mensagem** (`lib/copiar.ts`, com plano B para navegador
  antigo; vale para os DOIS lados — pedido, Pix, endereço),
  **encaminhar** para até `TETO_DESTINOS` conversas (`lib/encaminhar.ts`): os
  envios saem em FILA depois da resposta, com o ritmo anti-ban da RN-017 —
  em paralelo o ritmo não acontece, e esperar dentro do pedido estourava o
  tempo da função e fazia a cliente receber duas vezes; a legenda da mídia vai
  como mensagem própria (o envio de mídia manda só o arquivo). Encaminhar É
  responder: assume a conversa, tira da fila e reabre, como qualquer envio.
  **Salvar a mídia** (`lib/midia-arquivo.ts`): `/api/messages/[id]/media?baixar=1`
  entrega como arquivo, com nome e extensão — foto/vídeo/áudio chegam sem nome
  e sem isso o navegador só ABRIA. A mesma porta serve inline para a bolha, mas
  só os tipos que ela desenha: arquivo que a CLIENTE manda e o sistema não
  exibe (um .html, um .svg) sai como download + `nosniff`, senão executaria no
  endereço do app com a sessão da vendedora aberta.
  **menu da conversa** (clique direito no computador, toque longo no celular,
  `menu-da-conversa.tsx`): **fixar/desafixar** (topo da lista, em qualquer
  aba), **marcar como não lida** ("volto nessa depois" — fecha o chat junto,
  senão o sync zeraria o marcador), **favoritos** (com filtro próprio) e
  **bloquear** (gerência; é o bloqueio DE VERDADE no WhatsApp — sem conexão a
  rota RECUSA, e só grava `Customer.blockedAt` depois que o WhatsApp aceita:
  dizer "bloqueada" com mensagem chegando seria pior que não ter o botão).
  Fixada e favorita são da CONVERSA, não de cada pessoa — a Central é
  compartilhada. O menu MEDE a si mesmo e vira para o lado que tem espaço
  (`lib/menu-flutuante.ts`, teste varre a janela inteira): conversa no pé da
  lista abria um menu com metade embaixo da borda,
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
- **RN-024 · Dados de envio pela própria cliente** (`lib/dados-envio.ts`):
  o botão 📦 do chat manda um link e a CLIENTE preenche o próprio cadastro —
  endereço, CPF **ou** CNPJ (PJ abre razão social + inscrição estadual), com
  CEP puxando o endereço sozinho. O que a ficha já tem aparece para conferir,
  documento MASCARADO; o que ela mandar VALE (ela sabe onde mora), com
  registro na linha do tempo e aviso no sino da dona da carteira (sem dona,
  gerência). **Exceção: o NOME da ficha é do VENDEDOR** — o nome digitado no
  formulário só entra quando a ficha ainda tem o crachá provisório
  (`nomeProvisorio`, mesma regra do intake); se diferir do nome da ficha, a
  loja é avisada ("ela se apresentou como X") e o nome do vendedor fica. O
  link é CURTO (código de 11 caracteres sorteado a cada clique — 64 bits, não
  se adivinha — guardado em `DadosEnvioLink`; o crachá HMAC inteiro na URL
  passava de 200 caracteres e assustava no WhatsApp) e vence em 7 dias (o
  link ESCREVE na ficha); o leitor (`lib/dados-envio-link.ts`) aceita também
  o formato antigo — link já enviado segue valendo até vencer. Na
  unificação de contatos, razão social e IE viajam JUNTO com o CNPJ (e o
  waName acompanha) — o CNPJ ir sozinho deixava a razão para trás, e ela sai
  nos documentos. **Completo não se marca na mão**: a régua é a
  MESMA da compra de etiqueta (`dadosDeEnvio`, fonte única) — ficha completa
  faz o botão avisar a vendedora antes de pedir de novo. O telefone NÃO está
  no formulário (é a identidade da cliente, lição da RN-021). **Razão
  social**: a ficha fica no nome de QUEM CONVERSA; `Customer.legalName` sai
  onde documento manda — NF-e, etiqueta e declaração (`nomeParaDocumentos`)
  — e anda junto do CNPJ (apagou o CNPJ, some a razão). **Nome no WhatsApp**
  (`Customer.waName`): gravado sozinho pelo webhook (pushName), aparece na
  ficha e no chat e é encontrável na busca — organização interna, nunca vai
  para documento.
- **RN-023 · Conectar integração é ato da PRÓPRIA loja** (`lib/oauth-state.ts`,
  vale para Nuvemshop, Bling, Mercado Pago e Melhor Envio): o crachá do OAuth
  (`state`) é SORTEADO a cada clique e vence em 15 min, e a volta do provedor
  só é aceita se quem voltou estiver logado NA MESMA loja com permissão de
  integrações (`sessaoAutorizadaPara`). O crachá antigo era
  `companyId.HMAC(companyId)` — o mesmo texto para sempre: quem o visse podia
  montar o link de autorização e mandar para outra pessoa, que autorizava a
  conta DELA e os tokens (com a carteira do Melhor Envio e o endereço do
  remetente) caíam na loja de quem mandou o link. O resultado da volta é DITO
  na tela de Configurações (`resultado-conexao.tsx`; a Nuvemshop no cartão
  dela), com os dois motivos separados — `outra_loja` (o link era de outra
  pessoa) e `sem_sessao` (a volta caiu fora do login, típico de quem usa o
  app instalado) —, senão a trava vira "não funciona e não explica".
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
  **RN-026 · WhatsApp e catálogo público são UM canal só nas métricas**
  (`lib/canais.ts`, 31/08/2026): a origem do cadastro separa os dois por
  acaso técnico — a cliente que chama no WhatsApp recebe o link do catálogo
  e pede por ele; separados, o canal das vendedoras parecia dois canais
  pequenos ao lado da Nuvemshop e a loja tirava conclusão errada de onde
  investir. Toda tela que AGREGA por canal (Marketing — inclusive o filtro
  por canal —, Relatórios e a exportação CSV) soma os dois como "WhatsApp e
  catálogo"; Nuvemshop e os demais seguem separados. A soma é SÓ DE
  APRESENTAÇÃO: `Customer.origin` continua gravado separado no banco (ficha,
  intake e regras por origem não mudam), e o painel de Gestão da plataforma
  tem régua própria e fica de fora.
- **Produção** (gated por loja): tecidos, rolos, cortes multi-cor, costura,
  lotes/facções, defeitos, simulador, etiquetas.
- **Financeiro** (gated por loja, pago à parte — R$ 160 de tabela no catálogo
  de módulos): gestão financeira completa, desenhada com o dono em 31/08/2026
  (mapa em 6 fases: cadastros → contas a pagar/receber → recorrência/extrato →
  porta única de entrada das vendas → dashboard/DFC → DRE/conciliação OFX).
  **RN-027 · Módulo Financeiro** (`Company.financeEnabled`, porteira em
  `lib/financeiro/gate.ts`): TODA porta do módulo (API e tela) exige a chave
  da loja E gerente/admin — vendedora e SUPORTE ficam fora (dinheiro é assunto
  comercial, mesma régua de Relatórios); sem a chave a rota responde 404 e a
  loja **não muda em NADA** (segue a tela simples de contas a receber de
  pedidos). Fase 1 (cadastros, `lib/financeiro/cadastros.ts`): contas (saldo
  inicial com data — o saldo nunca será digitado, será somado), categorias em
  árvore numerada que **nasce pronta para moda** (semeadura idempotente na
  primeira abertura; o CÓDIGO é o servidor quem dá, e filha HERDA o tipo da
  mãe — categoria de receita debaixo de despesa faria o DRE somar errado),
  centros de custo, coleções ("o Inverno 2026 deu lucro?") e fornecedores
  (CNPJ/CPF com dígitos conferidos antes de gravar; IE anda junto do CNPJ;
  categoria padrão só de DESPESA). **Cadastro não se apaga, se ARQUIVA** — a
  API nem tem DELETE: quando os lançamentos chegarem, apagar conta/categoria
  com histórico quebraria extrato e DRE. Clientes NÃO ganham cadastro novo: o
  financeiro usa a ficha do CRM.
  **RN-028 · O LANÇAMENTO** (`lib/financeiro/lancamentos.ts`, telas
  `/financeiro/contas-a-receber` e `/contas-a-pagar`): conta a receber e a
  pagar são a MESMA peça, mudando o lado (`FinLancamento.tipo`) — cabeçalho →
  **parcelas** (`FinParcela`) → **baixas** (`FinBaixa`, o dinheiro andando).
  O **status NUNCA é digitado** (sai do vencimento + baixas) e **o vencimento
  manda**: parcela paga pela metade E vencida é ATRASADA, não "parcial" — o
  dinheiro está atrasado do mesmo jeito (antes ela entrava no card Atrasado
  mas sumia ao filtrar por atrasado, e a lojista cobrava a metade errada da
  lista). PARCIAL é o que tem parte paga e ainda não venceu. O **valor do
  lançamento é a SOMA das parcelas**, calculada no servidor. **Centavo não some**: R$ 100 em 3× é
  33,33 + 33,33 + **33,34** (a sobra vai para a última) e o vencimento
  mensal do dia 31 cai no último dia do mês curto — nunca vaza para o mês
  seguinte, que faria a parcela sumir do relatório. **Data é DIA, guardado ao
  MEIO-DIA em UTC** (`dataDoDia`): meia-noite viraria o dia anterior em São
  Paulo. Na baixa, **abatimento, desconto e juros são três números
  diferentes** — a parcela de R$ 100 paga com R$ 10 de multa QUITA a parcela
  e movimenta R$ 110 na conta; somá-los antes de gravar faz o extrato
  divergir do banco. **Baixa parcial** é normal ("metade agora"), e **baixa
  errada se ESTORNA** (fica riscada na ficha, com quem e quando), nunca se
  apaga; desconto maior que o abatimento é recusado (moveria dinheiro
  NEGATIVO na conta). Com baixa ativa não se cancela; **editar é mais
  rígido — QUALQUER baixa, mesmo já estornada, trava a edição**: editar
  refaz as parcelas e as baixas penduradas nelas iriam junto (o cascade
  apagaria justamente o registro de que algo deu errado). Lançamento com
  movimento se cancela e se refaz. Os **cards somam o período INTEIRO**, nunca
  só as 500 linhas exibidas; no recorte por **liquidação** o card de
  recebido/pago soma o que MOVIMENTOU na conta dentro da janela (com juros e
  desconto) — é esse número que bate com o extrato do banco. A baixa roda em transação **SERIALIZÁVEL**: sem isso duas pessoas
  dando baixa na mesma parcela ao mesmo tempo passam as duas pela conferência
  e a parcela fica paga em dobro. Categoria escolhida tem que ser do MESMO
  lado do lançamento (receita numa conta a pagar faria o DRE somar errado).
  Anexos (boleto, comprovante) são data-URL e saem sempre como download com
  `nosniff`; **o anexo é a ÚNICA coisa do módulo que se apaga** (anexou o
  boleto errado), com registro no histórico. Lançamento com `origem` diferente
  de MANUAL (Fase 4) não aceita edição de valor — a fonte da verdade é o
  pedido, e o único (companyId, origem, origemId) garante "1 pedido = 1
  lançamento".
  **RN-029 · CONTAS FIXAS** (`lib/financeiro/recorrencia.ts`, tela
  `/financeiro/contas-fixas`): aluguel, salário, internet — a loja configura
  UMA vez (valor, dia, categoria, "sem fim" ou até quando) e o sistema
  materializa os lançamentos dos **próximos 3 meses** sozinho. **NÃO é cron**
  (ADR-002: um 3º cron trava TODOS os deploys em silêncio): roda de CARONA no
  tráfego ao abrir as telas do financeiro, e a consulta é barata — só as
  contas fixas que ainda não chegaram no horizonte. **Nunca duplica**: o
  lançamento gerado carrega (recorrenciaId, mês) e esse par é ÚNICO no banco,
  então duas abas abrindo juntas esbarram no índice (P2002 tratado), não em
  dois aluguéis. Dia 31 cai no último dia do mês curto (mesma régua da
  RN-028). **Editar e encerrar mexem SÓ no futuro**: os meses que ainda não
  venceram e **não têm baixa** são refeitos; o que já foi pago fica intocado —
  o aluguel de agosto continua tendo sido o de agosto. Conta fixa que começou
  anos atrás não trava a tela (teto de 24 meses por rodada).
  **RN-030 · TRANSFERÊNCIA E EXTRATO** (`lib/financeiro/extrato.ts`, telas
  `/financeiro/transferencias` e `/extrato`): transferência entre contas da
  PRÓPRIA loja **não é receita nem despesa** — contá-la como receita infla o
  faturamento e como despesa inventa prejuízo; ela sai de uma conta, entra na
  outra e some no total da loja. Tem **DUAS datas** porque a vida tem: a TED
  sai hoje e cai amanhã, e cada conta enxerga o dinheiro no SEU dia (uma data
  só faria o saldo de uma delas mentir por um dia); o dinheiro não pode cair
  antes de sair, e transferência errada se CANCELA com quem e quando, nunca se
  apaga. No **extrato**, o **saldo NUNCA é digitado, é SOMADO**: saldo inicial
  da conta (a partir da data que a loja declarou) + tudo que entrou − tudo que
  saiu, com o acumulado linha a linha — não existe campo "saldo atual" no
  banco para alguém corrigir na mão e a tela passar a mentir. Os cards de
  entrou/saiu contam só receitas e despesas realizadas; a transferência
  aparece na lista mas fica FORA deles.
  **RN-031 · A PORTA ÚNICA DE ENTRADA DAS VENDAS**
  (`lib/financeiro/porta-vendas.ts`): TODA venda entra no financeiro por um
  lugar só — pedido do sistema, pedido do catálogo, venda da Nuvemshop, Pix
  confirmado (`settle-order`) e, amanhã, Mercado Livre: cada origem só
  traduz o que tem, nenhuma escreve lançamento por conta própria (é o que faz
  "marketplace novo" custar um tradutor, e não uma reforma nas telas).
  **1 PEDIDO = 1 LANÇAMENTO, para sempre**: o par (loja, origem, origemId) é
  ÚNICO no banco, então reprocessar o mesmo pedido — e o gateway REENVIA o
  mesmo aviso, é o contrato dele — não cria dois recebimentos. A porta é
  chamada em TODA transição e acerta o que mudou — a regra vive numa **máquina
  de estados pura** (`decidirAcaoDaPorta`), testada sem banco: pago ganha
  **baixa automática do que FALTA** na conta padrão (sinal registrado à mão
  não trava mais a baixa, e sem conta padrão ela NÃO inventa uma — anota no
  histórico); voltar para aguardando **estorna só a baixa DELA**; cancelar
  **ou voltar a ORÇAMENTO** desfaz e cancela (senão ficaria dinheiro que
  nunca entrou no extrato); e o **valor acompanha o pedido** — pedido de R$
  100 editado para R$ 450 refaz o lançamento e a baixa, porque o automático
  não aceita edição na tela (RN-028). **O QUE A LOJISTA FEZ NA MÃO É DELA**:
  baixa manual e cancelamento manual nunca são desfeitos — a porta avisa no
  histórico (uma vez, sem virar spam) e para. A venda entra pelo `total` (o
  que a cliente paga, **frete-ok**; faturamento continua `netTotal` por
  RN-002), com a categoria da origem (atacado, varejo, loja online) e as
  datas ao **meio-dia UTC** (RN-028 — carimbo cru some do filtro do mês).
  A **etiqueta do Melhor Envio vira despesa de frete já baixada**, chaveada
  pelo `meOrderId` (a COMPRA, não o envio: recomprar de PAC para SEDEX é
  outra despesa), e **cancelar a etiqueta estorna e cancela a despesa** — o
  valor voltou para a carteira ME. **NUNCA ATRAPALHA A VENDA E NUNCA SOME**:
  o trabalho vai no `after()` do Next — chamada solta seria congelada pela
  Vercel junto com a resposta, e a venda paga desapareceria do financeiro sem
  erro nenhum. Loja sem o módulo (RN-027): a porta sai calada.
- **Envios** (gated por loja, `shippingEnabled`, pago à parte): tela própria
  no menu (`/envios`): painel (gasto do mês, aguardando postagem, em
  trânsito com alerta de **parado há 7+ dias**, entregues com tempo médio) +
  lista de tudo que saiu (transportadora, destinatária, rastreio com copiar
  código/link público, status vivo) — a lista respeita RN-007 (`orderScope`)
  e a abertura da tela dá carona na varredura de rastreio. **Mapa de envios**
  (`lib/envios/mapa.ts` + `mapa-envios.tsx`): o Brasil pintado por estado
  (mais envios = cobre mais forte) com bolinha em cada cidade de destino e
  lista de estados com quantidade (só estado com 1+ envio) — tudo offline:
  contornos e coordenadas dos 5.570 municípios foram gerados uma vez
  (`scripts/gerar-mapa-envios.mjs`) e commitados; cidade que não casa com a
  base vira ponto no centro do estado (envio nunca some do mapa).
  **RN-022 · Dois recortes** (21/08/2026): **"Todos os pedidos pagos"**
  (padrão) conta TODO pedido pago (RN-001) com endereço — a loja também
  despacha por motoboy, transportadora própria e retirada, e esses pedidos
  não têm etiqueta; **"Melhor Envio"** conta só as etiquetas compradas aqui
  (aí a cancelada fica de fora, como no gasto do mês; etiqueta de pedido não
  pago CONTA nesse recorte — o dinheiro saiu, mesma régua do gasto do mês, e
  por isso ele NÃO é subconjunto do outro). O endereço vem da ETIQUETA
  quando existe (foi o impresso) e, fora isso, do cadastro da cliente
  (`enderecoDoPedido`): todo pedido montado no sistema nasce com uma CÓPIA
  do endereço da ficha, e cópia envelhece — corrigir a UF na ficha tem que
  chegar ao mapa. As duas fontes nunca se misturam (cidade de uma com UF da
  outra erraria o ponto). UF por extenso ("Minas Gerais", que a Nuvemshop
  grava) é traduzida para a sigla, e a cidade casa sem acento, hífen ou
  apóstrofo. O que não tem estado é CONTADO E DITO na tela ("N sem estado no
  cadastro"), inclusive quando o mapa está vazio — é o aviso que explica o
  vazio. Melhor Envio
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
- **Equipe · Fichas de funcionário**: **RN-025** · a ficha de RH é da
  EMPRESA, sem vínculo com login (a maior parte dos funcionários nunca entra
  no sistema). Salário, documentos, CPF/endereço, dependentes e observações:
  SÓ ADMIN — o gerente recebe o recorte básico + emergência/alergias, montado
  no servidor por lista do que ENTRA (`fichaBasica` em `lib/funcionarios.ts`;
  campo sensível novo nasce invisível). Ficha NUNCA é apagada: desligar
  arquiva com data/motivo (a API nem tem DELETE), e salário/desligamento
  ficam no histórico (quem, quando). Documentos entram como anexo com tipo e
  validade opcional (ASO/CNH/comprovante vencem — a tela avisa), com
  checklist adaptado ao vínculo (CLT completo; diarista/PJ o essencial).
  Raça/cor fica FORA do sistema (decisão LGPD com o dono, 26/08/2026).
  **Link do formulário** (`/ficha/<código>`, `lib/ficha-form-link.ts`): o
  admin manda o link e o FUNCIONÁRIO preenche a própria ficha pelo celular,
  sem login — código sorteado (padrão RN-024), vence em 7 dias e é de USO
  ÚNICO (o envio o consome). Aceite LGPD obrigatório ANTES de qualquer dado
  sair do aparelho. O formulário só aceita o que é DO funcionário
  (`formFichaSchema`, recorte por lista: remuneração/cargo/vínculo mandados
  junto são descartados); a resposta NÃO entra na ficha — fica **aguardando
  conferência**, e o admin aprova (grava só o preenchido; campo em branco não
  apaga nada) ou dispensa, com registro no histórico. Documento anexado pelo
  link entra na pasta na hora (um POST por arquivo, teto por link) e o admin
  pode remover na conferência. **O formulário é CURTO de propósito**
  (28/08/2026): começa pelo **nome completo** (dele, já preenchido com o que
  o admin digitou — só viaja se ele CORRIGIR, senão uma aba aberta há dias
  desfaria a correção feita na ficha) e pede **só a foto do CPF** — sem
  escolher tipo e sem data de validade, que quem rotula é o SERVIDOR
  (`CPF_DOC` fixo). A lista inteira de documentos e o vínculo ("informal")
  saíram da tela do funcionário: assustavam e ninguém preenchia — e o
  vínculo é classificação interna da empresa. O checklist por vínculo e o
  anexo de qualquer tipo, com validade, seguem inteiros na tela do ADMIN.
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
