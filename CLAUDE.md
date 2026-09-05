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
  vê. Exceção: mudança trivial sem lógica (texto, cor, label) — e, por
  pedido do dono (02/09/2026), **conserto simples de tela vai pela via
  rápida**: implementar direto, testes + build e push, sem a revisão
  completa. A revisão completa continua obrigatória quando a mudança cria
  ou altera REGRA de dinheiro/estoque ou porta pública.
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
  **RN-045 · Código de login pelo WhatsApp em aparelho novo**
  (`lib/auth-codigo.ts`, 02/09/2026): segundo fator do jeito deste público —
  nada de app autenticador; o código de 6 dígitos chega no WhatsApp da
  própria pessoa, mandado pela conexão da própria loja. **Opt-in por loja**
  (chavinha na tela Equipe, nasce DESLIGADA) e **por pessoa**
  (`User.loginPhone`, cadastrado ali). Aparelho conhecido não pede código
  por 90 dias (cookie assinado por HMAC, de UMA pessoa — outra conta no
  mesmo aparelho pede). O código nunca é guardado (só o HMAC), vale 10 min
  e morre com 5 erros, contados ANTES de conferir. **NUNCA TRANCA A LOJISTA
  FORA**: sem telefone cadastrado, ou com o WhatsApp da loja caído/envio
  recusado, o login entra como sempre e o ocorrido fica registrado
  (`login.codigo-falhou` na Central de Comunicação) — fail-open consciente
  e documentado.
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
  **RN-047 · Marcar "pago" na mão confirma UMA cobrança, não todas**
  (`escolherCobrancaAConfirmar` em `lib/orders.ts`, 03/09/2026): relato do
  dono — *"o cliente pagou R$ 553,50, porém no sistema consta que ele pagou
  R$ 554,50"*. O mesmo pedido tem, normalmente, MAIS DE UMA cobrança
  pendente: o pedido do catálogo já nasce com uma (RN-010) e a vendedora
  ainda gera o QR do Mercado Pago ou o link da InfinitePay para mandar no
  WhatsApp. São **caminhos alternativos do mesmo dinheiro** — a cliente paga
  por UM. Marcar pago confirmava TODAS: pedido de R$ 554,50 constava como
  R$ 1.109,00 recebidos e a ficha anunciava "pago a mais R$ 555,50". O
  caminho AUTOMÁTICO já acertava isso desde 07/08/2026 (`settleOrderPaid`:
  "confirmar todas escondia a conciliação"); o da mão ficou para trás. Agora
  vale a mesma régua da baixa da porta do Financeiro (RN-033): confirma **o
  que FALTA**, uma cobrança só. **A do gateway fica por último**, e por dois
  motivos que apontam para o mesmo lado: quem marca na mão recebeu POR FORA
  (dinheiro que entrasse pelo gateway já teria sido liquidado pelo webhook), e
  o alarme de **"🚨 SEGUNDO pagamento"** do `settleOrderPaid` só dispara
  enquanto existir linha PENDENTE com aquele id — carimbá-la faria a cliente
  pagar o QR depois e o dinheiro em dobro entrar CALADO. Entre as demais vale
  a mais RECENTE, que é o link que a vendedora acabou de mandar. O valor
  gravado é o que falta, **mas cobrança do gateway nunca é reescrita** (o
  número dela é o que o provedor tem, e mudá-lo quebraria a conferência com o
  extrato). As irmãs **não viram pagamento e não somem**: param de valer aqui
  E no provedor (o Pix do Mercado Pago é cancelado lá — vencer só no nosso
  banco não impede a cliente de pagar o código que já está no WhatsApp dela) e
  a ficha as mostra como **"cobrança não usada"** em cinza — dizer "Pendente"
  ali faria a loja procurar um dinheiro que não falta. O que **continua sendo dito** é a
  diferença de verdade: pedido corrigido DEPOIS do pagamento confirmado
  mostra "falta cobrar"/"pago a mais" (relato Entre Linhas, 02/09/2026) —
  pagamento confirmado é história e não se reescreve.
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
  **RN-027 · Campos do pedido escolhidos por loja**
  (`lib/catalogo/campos-do-pedido.ts`, 31/08/2026): além de nome e telefone,
  a loja escolhe em Configurações → Catálogo quais campos o pedido pergunta
  — CEP, endereço, bairro, cidade, UF — cada um com chavinha de obrigatório
  (uma loja cota frete pelo CEP, outra entrega de motoboy e vive de bairro).
  Cardápio FECHADO: cada campo cai numa coluna da ficha da cliente (campo
  livre viraria dado sem casa). O que ela preenche VALE na ficha (régua da
  RN-024; em branco não apaga nada) e fica escrito no pedido e na mensagem.
  **Recorte por lista no servidor**: a rota só aceita o que a loja
  configurou. **Obrigatório trava só o navegador** — o servidor aceita o
  pedido sem o campo, porque pedido do catálogo não pode se perder (RN-010)
  e o reenvio automático guarda payload antigo. Loja que não configurar
  nada não muda em NADA.
  **RN-040 · Condições do LINK DE CAMPANHA, editáveis sem trocar o endereço**
  (`lib/catalogo/condicoes-da-campanha.ts`, 01/09/2026): o link de campanha
  da tela Inteligência (`?ref=`) deixou de só rastrear — a loja define nele um
  **desconto** e um **pedido mínimo próprios** (menos peças, ou nenhum), e
  **edita isso quando quiser**. O que NUNCA muda é o **endereço**: ele já foi
  mandado no grupo, impresso no QR e colado no story (pedido do dono) — a
  rota de edição nem aceita `slug`. Quem manda no preço é o SERVIDOR
  (RN-009); a condição viaja no pedido em campo PRÓPRIO, separada do `ref`,
  porque o `ref` pode vir LEMBRADO do aparelho (comissão, RN-005) e desconto
  lembrado cobraria o que a vitrine não mostrou. **Descontos NÃO se somam**:
  com tabela de preço (RN-018) ou catálogo promocional na mesma visita, a
  condição do link não entra. Campanha **pausada** volta o link ao catálogo
  normal (nunca 404 — pior que perder o desconto é o link divulgado quebrar)
  e para de contar visitas para ela no relatório. **O pedido NUNCA é recusado por
  mudança de condição** — editar desconto é a ação de todo dia que esta regra
  criou, e pedido da fila do aparelho que volta recusado é DESCARTADO pelo
  reenvio (o incidente da RN-010). O pedido leva o desconto que a vitrine
  MOSTROU; se ele não bate com o de agora (nos dois sentidos: sumiu cobraria a
  mais da cliente, apareceu faria a loja receber menos que o combinado), o
  pedido ENTRA pelo valor do servidor e a diferença é **gritada na ficha e no
  histórico** para a loja confirmar antes de cobrar. O desconto que precificou
  fica **gravado no pedido** (`Order.campaignRef`/`campaignDiscount`) — e peça
  acrescentada depois segue esse desconto (senão três linhas saíam a R$ 80 e a
  quarta a R$ 100, no mesmo pedido), e o
  resgate **"Colar pedido do WhatsApp"** lê o carimbo `_Campanha: X (N% OFF)_`
  da mensagem: sem isso a lojista colava um pedido aprovado por R$ 800 e o
  sistema criava de R$ 1.000. **Mas o número do texto NÃO decide dinheiro** —
  a mensagem do wa.me é digitável, e "(90% OFF)" daria 90% sobre o cadastro:
  o texto diz QUAL campanha e a porcentagem só CONFERE; o desconto sai do
  cadastro da loja (`descontoDoResgate`). Não bateu — campanha xará, renomeada,
  pausada, porcentagem mudada —, vale o preço CHEIO e a prévia **avisa**
  (remontar calado é o incidente). É a diferença para o `tabelaNoTexto`, que
  escolhe entre dois preços que já são nossos. Pausar também tem efeito em
  comissão: pedido pelo link pausado nasce **sem vendedora** (é da loja, por
  RN-005), e a tela diz isso antes de pausar. **Endereço de campanha é da
  campanha, mesmo pausada** (`resolveRef`): antes o mesmo `?ref=` caía na
  regra do primeiro nome e a campanha "Julia" da Ana, pausada, passava a
  creditar a VENDEDORA Julia — levando a carteira da cliente junto. Endereço de campanha
  encerrada **fica reservado** (recriar herdaria os cliques dela), e a tela
  diz isso. **Excluir**: campanha sem nenhum clique some
  de vez; a que já trouxe gente vira **encerrada** — sai da lista e o link
  para de valer, mas os números seguem no relatório (venda não se apaga,
  régua da RN-025). Os números de cada campanha (cliques, pedidos,
  faturamento) aparecem **também no celular** — estavam escondidos em tela
  pequena, e é ali que a lojista lê (o caminho do número até o pedido está na
  regra seguinte).
  **RN-041 · Preço sugerido ao acrescentar peça no pedido tem UMA regra só**
  (`precoSugeridoNoPedido` em `lib/orders.ts`, 01/09/2026): existia em três
  lugares com três regras — montar pedido usava ATACADO, acrescentar peça num
  pedido existente usava a tabela do pedido (nula em quase todo pedido, então
  caía no VAREJO) e a listinha de busca DESSA MESMA TELA mostrava ATACADO. A
  lojista via R$ 80 na lista e a linha entrava com R$ 100 — e o `unitPrice`
  que a tela manda é o que vira o pedido. A regra é a **ORIGEM do pedido**:
  link de tabela (RN-018) segue a tabela dele; loja online (Nuvemshop) é
  varejo, que é o preço de lá; pedido do catálogo segue a tabela que o
  catálogo daquela loja mostra; sem origem conhecida vale atacado (é o que a
  tela de montar pedido sempre fez). O desconto do link de campanha (RN-040)
  entra por cima. **Fica assim, por decisão do dono (01/09/2026)**: nada
  carimba `MANUAL` hoje (`Order.source` nasce "CATALOGO"), então o pedido
  montado à mão numa loja com o catálogo em VAREJO vê atacado numa tela e
  varejo na outra. Carimbar resolveria, mas mexe no relatório de origem de
  pedidos antigos e pede backfill — e só atinge loja com o catálogo em varejo,
  com o valor editável antes de salvar. Se voltar à mesa, é entrega própria:
  carimbo + backfill dos pedidos antigos, para o canal "Catálogo" não
  aparecer despencando de um mês para o outro.
  **Não se resolve carimbando `Order.priceMode` em todo pedido** — foi tentado
  e recusado na revisão: ele não é só informação de preço, a porta única do
  Financeiro (RN-033) escolhe a CATEGORIA da receita por ele, e carimbar
  mudaria a venda do catálogo de loja varejo de "Venda atacado" para "Venda
  varejo" no meio do ano, quebrando a linha do DRE.
  **RN-042 · Contagem de venda sempre aponta para um pedido que EXISTE**
  (`lib/order-actions.ts` + `lib/campanha-pedidos.ts`, 01/09/2026): relato do
  dono — *"fala que tem um pedido, mas esse pedido não chegou aqui"*. O pedido
  do catálogo marca `TrackSession.converted` ao nascer, e **apagar o pedido
  nunca desmarcava**: a campanha seguia anunciando uma venda que não existe
  mais, o funil contava "enviou pedido" e — o pior — a **recuperação parava de
  procurar aquela cliente**, achando que ela já tinha comprado. Agora o funil
  ÚNICO de exclusão (`reverseAndDeleteOrder`, as duas portas: tela de Pedidos
  e funil de vendas) desmarca a visita, DENTRO da transação, e só quando não
  sobrou nenhum outro pedido dela. **E o número leva ao pedido**: "N pedidos"
  no cartão da campanha é link para `/pedidos?campanha=<slug>`, com faixa
  dizendo o recorte e como sair. Um pedido é da campanha por DOIS caminhos, e
  os dois valem: o carimbo (`Order.campaignRef`) e a sessão
  (`Order.trackSessionId`) — sem o segundo, todo pedido anterior ao carimbo
  sumiria da busca. O contador soma **PEDIDO**, não sessão convertida, pela
  MESMA régua da lista — e a lista abre no MESMO período do cartão, senão o
  número e a lista discordam de novo. Pedido **CANCELADO** não conta (é
  dinheiro que não vem), e a busca pela visita **não depende** da marca de
  conversão (ela é gravada em best-effort: depender dela sumiria com pedido
  pago de verdade). Endereço de campanha que não existe mostra **aviso**,
  nunca a loja inteira disfarçada de resultado da campanha. E **"R$ 0" com pedido na conta diz "aguardando
  pagamento"** — faturamento soma só pedido pago (RN-001), e sem a frase o
  cartão parecia defeito.
  **RN-043 · O pedido do catálogo é UMA bolha só na Central**
  (`lib/comm/bolha-do-pedido.ts`, 01/09/2026): relato do dono — pedido de
  teste, UMA mensagem no WhatsApp do celular, DUAS idênticas na Central. Não
  era o WhatsApp entregando em dobro (isso o webhook já barra pelo id): eram
  DOIS CAMINHOS gravando a mesma coisa — o catálogo grava a mensagem do pedido
  na conversa na hora em que ele nasce (RN-010: a loja vê o pedido mesmo sem
  WhatsApp conectado), e segundos depois a cliente aperta "enviar" no wa.me e
  a mensagem de verdade chega pelo webhook, que nunca ouviu falar da bolha do
  catálogo. Agora a mensagem do WhatsApp com o MESMO texto, da MESMA cliente,
  dentro de 30 min da bolha do catálogo, **É a bolha do catálogo**: ela ganha
  o id do WhatsApp e o status de recebida — nada é criado e apagado depois
  (deixaria brecha para o sync mostrar as duas). Só casa bolha **sem id do
  WhatsApp** e **só texto**: a cliente mandar o mesmo texto duas vezes de
  propósito aparece duas vezes, como no celular dela. **Vale nos DOIS sentidos, dentro da mesma meia hora**: qualquer um dos
  caminhos pode vencer a corrida, e se o webhook gravou primeiro é o catálogo
  que reaproveita a mensagem do WhatsApp (a bolha COM id — nunca a sem id,
  que é a bolha de OUTRO pedido do catálogo — e só se ela chegou DEPOIS do
  último pedido da cliente: a que já foi a bolha do pedido anterior não serve
  para o que está nascendo, senão repetir o mesmo pedido minutos depois sem
  apertar enviar sumia com o segundo). **A regra mora DENTRO do
  `intakeLead`** (opção `reaproveitarBolha`: o webhook pede `do-catalogo`, o
  catálogo pede `do-whatsapp`), no mesmo passo que cria a mensagem, sob
  **trava por cliente**
  (`pg_advisory_xact_lock`): os dois caminhos chegam JUNTOS — o navegador
  dispara o pedido e abre o wa.me no mesmo instante — e conferir por fora,
  antes do intake, deixava a corrida que fazia o duplicado voltar de vez em
  quando. Dentro da trava também entram o **id do WhatsApp** (a cliente
  reenviando o mesmo pedido em paralelo vira duas bolhas, não uma com o id
  trocado) e a **reabertura da conversa** da bolha (mensagem que chega reabre,
  como sempre); se a corrida deixou uma conversa vazia, o consolidate de
  sempre junta na hora. A decisão de qual bolha reaproveitar é função pura
  (`escolherBolha`); a janela de 30 min é o recorte, não um "últimas N".
  **O que foi construído e RETIRADO** foi a janela de DIAS para o pedido da
  fila do aparelho (RN-010) gravado muito depois da mensagem de verdade: com
  ela, a cliente que repetisse o MESMO pedido na quinta reaproveitava a bolha
  de segunda e, sem apertar enviar, o segundo pedido não aparecia no chat
  NUNCA. Um pedido invisível é pior que uma bolha a mais no reenvio raro da
  fila. Limite aceito.
  **RN-044 · Porta pública de escrita tem RITMO** (`lib/rate-limit.ts`,
  chaves `cat:`/`catip:`/`demo:`, 02/09/2026): pedido NOVO do catálogo tem
  teto por IP+loja (20/15min) e por IP (60/15min) — sem isso, um script
  criava pedidos falsos de graça, cada um RESERVANDO estoque sem prazo
  (RN-003): o ataque mais barato contra uma loja. A trava CONVIVE com a
  RN-010: fica DEPOIS da idempotência (reenviar o MESMO pedido nunca é
  barrado), quem já está bloqueado não conta de novo (o reenvio automático
  não estica o próprio bloqueio) e o 429 NÃO descarta o pendente no
  aparelho — ele entra sozinho na próxima visita. Trava que fecha deixa
  rastro (`catalogo.flood` na Central de Comunicação); sem IP identificável
  não trava (melhor aceitar que agrupar o mundo). O formulário de
  demonstração tem o mesmo ritmo. Junto, o porteiro global fechou o alçapão
  do ponto (`lib/porteiro.ts`): só arquivo estático FORA de /api dispensa
  sessão — caminho com ponto no meio não é mais passe livre.
  **RN-046 · A lista de conversas NÃO PERDE O LUGAR**
  (`lib/lugar-na-lista.ts`, 03/09/2026): relato da loja — a vendedora faz
  follow-up **de baixo para cima** (desce até as conversas antigas, abre uma,
  encerra) e voltava para o **topo** da lista, tendo que rolar tudo de novo a
  cada atendimento. A causa é do NAVEGADOR, não da tela: no celular a lista é
  a mesma coluna do chat e fica escondida com `display:none` enquanto a
  conversa está aberta — **elemento escondido perde a rolagem**, e na volta o
  `scrollTop` é zero. Então o lugar é guardado por nós a cada rolagem e
  devolvido quando a lista reaparece, esperando o navegador refazer a conta da
  altura (`requestAnimationFrame`: sem isso a rolagem máxima ainda é a da
  lista escondida — zero — e o pedido é ignorado). **O que separa "ela subiu até o topo" de "o navegador
  zerou" é a ALTURA VISÍVEL**, não o scroll: lista escondida tem altura zero e
  não vira lugar guardado — mas o topo, com a lista visível, é lugar legítimo
  e fica guardado. A primeira versão guardava só posição maior que zero e
  deixava o topo inalcançável (a lista era puxada de volta ao lugar antigo a
  cada ida ao chat, achado da revisão). **No computador não mexe**: ali a lista
  fica ao lado do chat e já está no lugar; só devolve quando a lista está no
  topo E há lugar guardado. Lista que **encolheu** (a conversa encerrada saiu
  da aba) encaixa no máximo possível — pedir posição que não existe mais faz o
  navegador ignorar e voltar ao topo, o próprio bug. E o **atalho** que a loja
  pediu ("algum meio de descer sem ter que rolar"): um botão só, colado na
  base da coluna, apontando para onde ainda falta ir (↓ fim na metade de cima,
  ↑ topo na de baixo), que só aparece quando **sobra mais de uma tela para rolar** — em lista
  curta seria enfeite tampando conversa.
  **RN-048 · Envio que estourou o tempo NÃO é falha, é "confirmando"**
  (`lib/comm/entrega-incerta.ts`, 03/09/2026): relato do dono — quatro alarmes
  vermelhos em 24h na Central, todos do MESMO áudio. O envio bateu no teto de
  50s ("O WhatsApp demorou demais para responder"), a tela mostrou ⚠️ ERRO com
  o botão **Reenviar**, e a vendedora clicou três vezes — duas delas num
  instante em que o servidor de conexão estava fora do ar. A bandeira
  `incerto` JÁ EXISTIA no cliente do Evolution, com o aviso escrito em cima
  dela (*"quem for reenviar tem que olhar esta bandeira"*) — só que ninguém
  olhava: o resultado incerto era gravado como `FALHOU`, igual a uma recusa. E
  vermelho na tela é convite para reenviar, ou seja, o incidente da cliente
  recebendo a mesma mensagem duas vezes, agora pela mão da vendedora. Agora:
  tempo esgotado deixa a mensagem em **ENVIANDO com o motivo guardado**, e a
  bolha diz *"⏳ Confirmando a entrega… ela pode já ter chegado. Não precisa
  reenviar"* — **sem botão de reenviar**, de propósito. Quem resolve é o **ECO
  do próprio WhatsApp**: toda mensagem que a loja manda volta pelo webhook, e
  o resgate que já existia adota a bolha e a marca como enviada — só faltava
  dar TEMPO para o eco chegar. **A espera tem fim** (`MS_CONFIRMANDO_ENTREGA`,
  3 min, contados **de quando a mensagem ficou incerta** — pela data de
  nascimento, o REENVIO de uma mensagem antiga já nascia vencido e o vermelho
  voltava em segundos, achado da revisão): passada a janela sem eco, aí sim
  vira falha, com o texto honesto
  ("não deu para confirmar — PODE ter chegado"), e a **cliente volta para a
  fila** (o `lastOutboundAt` é RECALCULADO pela última mensagem que de fato
  saiu, nunca chutado) — dizer "confirmando" para sempre esconderia a mensagem
  que realmente não saiu. A varredura roda **de carona** no sync da inbox, com
  trava de 30s por loja — nunca um 3º cron (ADR-002). O REENVIO manual segue a
  MESMA régua (estourou de novo, volta a "confirmando", nunca ao vermelho).
  Reconhecer a "confirmando" é `ENVIANDO` **com motivo gravado**: envio em
  curso não tem motivo nenhum, então a varredura nunca confunde os dois.
  **Erro de CONEXÃO é outra coisa**: quando a conexão nem chegou a ser feita
  (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`…, lidos do `cause.code` do fetch),
  a mensagem com CERTEZA não saiu — essa ganha **uma** segunda tentativa
  automática 1,5s depois, e a queda de instantes passa sem a vendedora saber —
  **dentro do MESMO orçamento de tempo** (o que sobra do relógio é o teto
  dela; sem sobra, não há segunda tentativa): dois tetos cheios somariam
  50s + 50s e matariam a função no meio, que é o problema que o teto existe
  para evitar.
  Vale só para ENVIO: a leitura roda dentro do webhook, com orçamento curto.
  **`ECONNRESET` fica de fora de propósito** — a conexão cair no meio pode ter
  sido depois de o servidor receber tudo, e repetir aí duplicaria a mensagem,
  que é o erro que esta regra inteira existe para evitar.
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
  **A lupa também acha PALAVRA dentro da conversa** (03/09/2026, pedido do
  dono: "como no aplicativo do WhatsApp"): a mesma porta procura no texto
  das mensagens da loja (`buscarMensagens` em `lib/inbox-data.ts`) pelo
  **índice de texto** `Message_busca_palavra_idx` (GIN, migração
  20260903120000, criado CONCURRENTLY): a consulta usa a MESMA expressão do
  índice (texto em minúsculas, sem acento, barra vira espaço — "azul/branco"
  acha por "branco"); medido em 200 mil mensagens, LIKE levava 2,7 s e o
  índice 2 ms. Cada palavra digitada é PREFIXO, todas obrigatórias, em
  qualquer ordem (`consultaDePalavras`); letra solta cai fora e sem palavra
  de 3 letras não há busca. Mensagem apagada fica de fora; o recorte de quem
  vê cada conversa é o `conversationScope` de sempre (`veTodaAConversa`,
  num lugar só) e entra **DENTRO da consulta, antes do teto de resultados**:
  aplicado em cima ele fazia a vendedora que vê só as conversas dela receber
  "Nada encontrado" numa loja movimentada — as 300 mensagens mais recentes
  eram todas de colegas e sobrava zero (achado da revisão, 03/09/2026).
  Medido no Postgres local com 400 mensagens recentes das colegas e a dela
  mais antiga. A conferência contra a lista que ela já carregou continua
  acontecendo depois, de graça, como SEGUNDA tranca — isolamento não pode
  depender de um lugar só (RN-013). A lista mostra o TRECHO com a palavra pintada
  (`trechoDaBusca` em `lib/busca.ts`, posição no texto ORIGINAL) e quantas
  mensagens casaram; abrir a conversa PULA até a mensagem (carregando o
  passado página a página, com teto e aviso) e a barra ▲▼ anda entre elas.
  **Emoji**: o seletor (`seletor-de-emoji.tsx`, grade em `lib/emojis.ts`)
  tem **barra de pesquisa** em português sem acento ("coracao", "caixa",
  "feliz"; Enter escolhe o primeiro) e é o MESMO na caixa de **editar
  mensagem** — antes não dava para pôr emoji na mensagem editada.
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
  Comunicação). **A porta do WhatsApp oficial é fail-closed** (auditoria
  31/08/2026): sem o App Secret da Meta configurado, a loja NÃO ingere nada —
  antes a assinatura só era conferida quando o segredo existia, e quem
  descobrisse o `phone_number_id` (que não é segredo) injetava mensagem falsa
  criando cliente, conversa e lead em nome de gente que nunca escreveu. Recusa
  fica registrada (`webhook.recusado`), nunca em silêncio.
- **RN-028 · O ARQUIVO DA CLIENTE NÃO SE PERDE**
  (`lib/comm/midia-pendente.ts`, 31/08/2026 — ADR-015): o webhook não recebe o
  arquivo, recebe o AVISO de que ele existe, e precisa buscá-lo. O código
  baixava ANTES de gravar, e isso tinha dois buracos: (1) o webhook vivia 30s
  e cada download podia levar 45 — um lote de fotos, ou um documento lento,
  fazia a Vercel matar a execução no meio e as mensagens ainda não gravadas
  **sumiam sem rastro** (nem o registro de erro rodava); (2) falhou uma vez,
  perdeu para sempre — ninguém tentava de novo, nada ficava registrado. Agora
  a **mensagem nasce PRIMEIRO**, marcada como `mediaPending`, e o arquivo vem
  depois, com **orçamento de tempo** (12s por arquivo, 25s no lote, função de
  60s): estourou, as mensagens seguintes continuam sendo gravadas na hora e só
  o arquivo delas vai para a **fila de repesca** (espera crescente 1min → 6h,
  de carona no tráfego com trava — nunca cron novo, ADR-002). A repesca TOCA a
  conversa, senão o arquivo chegava ao banco e ficava invisível na tela (mesmo
  buraco da edição, da reação e do apagar). **Desistir é explícito**: sai da
  fila, a bolha DIZ que o arquivo não chegou e o caso vai para a Saúde e para
  a Central de Comunicação com o nome do arquivo. A tela mostra "Arquivo
  chegando…" enquanto a fila trabalha. Teto de ~12MB continua (a mídia mora
  como data-URL no banco, dívida nº 1): acima disso desiste NA HORA e avisa,
  em vez de insistir numa porta que não abre.
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
  direto). O SKU é comparado pelo que a lojista VÊ (`norm`): acento, caixa e
  **espaço** não contam — o espaço dobrado sem querer e o INVISÍVEL colado da
  planilha (nbsp) travavam o estoque em silêncio (31/08/2026). Diferença de
  verdade (pontuação, sufixo) segue NÃO casando — afrouxar aqui joga o
  estoque de uma cor em outra, o incidente que criou a regra. E SKU **quase
  igual** a um do cadastro não vira produto novo: antes a sync criava um
  espelho, a peça aparecia DUAS vezes no catálogo e o estoque ia para a
  cópia enquanto a de verdade seguia zerada. Agora vira **pendência com o SKU
  parecido do lado**, na tela de Configurações — a lojista vê o que difere e
  iguala (AVISA, nunca junta sozinho, como a RN-020).
  **A CONFERÊNCIA DA INTEGRAÇÃO TAMBÉM CONSERTA**
  (`lib/nuvemshop-conferencia.ts`): ela compara os dois lados (só leitura) e
  o botão **"Soltar N vínculo(s) errado(s)"** tira do caminho os carimbos
  objetivamente errados — vínculo apontando para peça de OUTRO SKU e vínculo
  de peça que não existe mais lá. Só isso: SKU duplicado, cor no produto
  errado e disputa exigem decisão da lojista. Estoque NÃO muda no clique (o
  número volta certo na próxima sincronização, pelo SKU), quem escolhe os ids
  é o SERVIDOR (a tela não manda lista) e as peças soltas ficam no `CommEvent`
  (até 200 identificadas por vez, sempre com o total).
  Leitura da Nuvemshop que veio pela metade — ou VAZIA — não autoriza soltar
  órfão (`leituraConfiavelParaSoltar`): peça não lida parece apagada, e um
  clique zeraria o catálogo inteiro. **O número do topo conta só TAREFA**
  (31/08/2026): disputa de sincronização cuja causa já foi corrigida sai da
  lista e da conta e vira uma linha de histórico no rodapé — o painel dizia
  "50 pontos para olhar" com 45 sendo lembrança de coisa resolvida, e as 5 de
  verdade sumiam no meio. "Já acabou" só vale quando deu para conferir: com a
  leitura incompleta a disputa continua avisando.
  **Jueri** (sync 2x/dia via cron `jueri-sync`).
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
  tem régua própria e fica de fora. A tela Marketing mostra também a OUTRA
  pergunta, **"Por onde a venda saiu"** (`saidaDaVenda`): o canal credita a
  venda a quem TROUXE a cliente (primeiro contato); a porta de saída olha o
  PEDIDO — loja online (`source` NUVEMSHOP), com vendedora ou sem vendedora —
  e é o recorte que bate com a tela de Comissões (cliente do WhatsApp que
  compra pela Nuvemshop conta no WhatsApp num gráfico e na loja online no
  outro; foi a diferença de R$ 9 mil que o dono caçou em 31/08/2026).
- **Produção** (gated por loja): tecidos, rolos, cortes multi-cor, costura,
  lotes/facções, defeitos, simulador, etiquetas.
- **Financeiro** (gated por loja, pago à parte — R$ 160 de tabela no catálogo
  de módulos): gestão financeira completa, desenhada com o dono em 31/08/2026
  (mapa em 6 fases: cadastros → contas a pagar/receber → recorrência/extrato →
  porta única de entrada das vendas → dashboard/DFC → DRE/conciliação OFX).
  **RN-029 · Módulo Financeiro** (`Company.financeEnabled`, porteira em
  `lib/financeiro/gate.ts`): TODA porta do módulo (API e tela) exige a chave
  da loja E gerente/admin — vendedora e SUPORTE ficam fora (dinheiro é assunto
  comercial, mesma régua de Relatórios); sem a chave a rota responde 404, a
  tela volta ao Dashboard e **a aba nem aparece no menu** (`itemVisivel` em
  `lib/menu-grupos.ts`, regra pura). **Loja sem o módulo não tem financeiro
  NENHUM** (pedido do dono, 05/09/2026): antes o painel "Financeiro" ficava
  no menu de toda loja como tela simples de pedidos a receber, e a loja sem o
  módulo via um financeiro pela metade — a tela simples SAIU. A porteira é
  UMA função para as rotas (`porteiraFinanceiro`) e outra para as telas
  (`porteiraFinanceiroTela`, todas as páginas, a raiz inclusive) — as 13
  páginas repetiam as seis linhas à mão e nenhum teste as varria; hoje a
  varredura cobre toda rota **por handler exportado** (arquivo com GET
  protegido e POST esquecido passava verde) e toda tela. Fase 1 (cadastros, `lib/financeiro/cadastros.ts`): contas (saldo
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
  **RN-030 · O LANÇAMENTO** (`lib/financeiro/lancamentos.ts`, telas
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
  **Editar e cancelar conferem DENTRO da transação, em SERIALIZÁVEL**
  (auditoria completa do módulo, 03/09/2026): conferindo de fora, a baixa que
  chegasse no meio era apagada em cascata pela edição, ou ficava viva num
  lançamento CANCELADO — o DRE pula a parcela, o extrato continua somando a
  baixa, e os dois divergem para sempre sem pista de onde. E o **lado não
  muda numa edição** (virar conta a receber em conta a pagar inverte o sinal
  no DRE e apaga o cliente). O **estorno é uma transação só**, senão a linha
  do banco seguia "conferida" contra dinheiro que voltou atrás. O **nome de
  quem fez** sai da porteira já desambiguado: "Sistema" é a identidade da
  baixa automática e está no índice único, então uma vendedora com esse nome
  tinha a baixa dela lida como automática (a porta a estornava sozinha) e
  levava 500 em vez de frase. O **filtro de situação vem ANTES do corte da
  página** — lendo 500 e filtrando depois, "Quitado" aparecia VAZIO numa loja
  com mais de 500 parcelas no mês, com o card mostrando o valor cheio — e
  quando nem os CARDS cabem, a tela DIZ. Anexos (boleto, comprovante) são
  data-URL e saem sempre como download com `nosniff`; **o anexo é a ÚNICA coisa do módulo que se apaga** (anexou o
  boleto errado), com registro no histórico. Lançamento com `origem` diferente
  de MANUAL (Fase 4) não aceita edição de valor — a fonte da verdade é o
  pedido, e o único (companyId, origem, origemId) garante "1 pedido = 1
  lançamento".
  **RN-031 · CONTAS FIXAS** (`lib/financeiro/recorrencia.ts`): aluguel,
  salário, internet — a conta fixa **nasce na MESMA janela de lançar a conta**
  (Contas a Pagar → Novo lançamento → "Todo mês"), porque é lá que a lojista
  vai quando pensa "tenho uma conta para pagar"; ter uma tela separada de
  cadastro a obrigava a escolher a porta certa ANTES de começar, e ela sempre
  entrava por esta. A tela `/financeiro/contas-fixas` fica para ACOMPANHAR:
  ver, editar e encerrar. A loja configura UMA vez (valor, dia, categoria, "sem fim" ou até quando) e o sistema
  materializa os lançamentos dos **próximos 3 meses** sozinho. **NÃO é cron**
  (ADR-002: um 3º cron trava TODOS os deploys em silêncio): roda de CARONA no
  tráfego ao abrir as telas do financeiro, e a consulta é barata — só as
  contas fixas que ainda não chegaram no horizonte. **Nunca duplica**: o
  lançamento gerado carrega (recorrenciaId, mês) e esse par é ÚNICO no banco,
  então duas abas abrindo juntas esbarram no índice (P2002 tratado), não em
  dois aluguéis. Dia 31 cai no último dia do mês curto (mesma régua da
  RN-030). **Editar e encerrar mexem SÓ no futuro**: os meses que ainda não
  venceram e **não têm baixa** são refeitos; o que já foi pago fica intocado —
  o aluguel de agosto continua tendo sido o de agosto. Conta fixa que começou
  anos atrás não trava a tela (teto de 24 meses por rodada).
  **RN-032 · TRANSFERÊNCIA E EXTRATO** (`lib/financeiro/extrato.ts`, telas
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
  aparece na lista mas fica FORA deles. Com o período TRUNCADO os três
  números saem do banco (auditoria de 03/09/2026): antes só o "saldo no fim"
  era somado lá e a própria aritmética da tela deixava de fechar. A
  **abertura da conta é evento de INÍCIO DE DIA** e vem antes dos movimentos
  daquela data — no desempate por id ela caía depois e a coluna Saldo
  mostrava um intermediário falso ("minha conta está negativa em R$ 500" num
  dia em que ela nunca esteve). E a data do saldo inicial é DIA ao meio-dia
  como todas as outras: com `z.coerce.date()` ela virava meia-noite UTC, e a
  abertura aparecia um dia antes no extrato e um MÊS antes no fluxo.
  **RN-033 · A PORTA ÚNICA DE ENTRADA DAS VENDAS**
  (`lib/financeiro/porta-vendas.ts`): TODA venda entra no financeiro por um
  lugar só — pedido do sistema, pedido do catálogo, venda da Nuvemshop, Pix
  confirmado (`settle-order`) e, amanhã, Mercado Livre: cada origem só
  traduz o que tem, nenhuma escreve lançamento por conta própria (é o que faz
  "marketplace novo" custar um tradutor, e não uma reforma nas telas).
  **1 PEDIDO = 1 LANÇAMENTO, para sempre**: o par (loja, origem, origemId) é
  ÚNICO no banco, então reprocessar o mesmo pedido — e o gateway REENVIA o
  mesmo aviso, é o contrato dele — não cria dois recebimentos. E **uma parcela
  nunca tem duas baixas automáticas vivas** (índice parcial no banco, P2002
  tratado): o PATCH do pedido e o aviso do gateway chegam juntos, liam o mesmo
  saldo e cada um criava a sua baixa — a venda de R$ 100 entrava R$ 200. A porta é
  chamada em TODA transição e acerta o que mudou — a regra vive numa **máquina
  de estados pura** (`decidirAcaoDaPorta`), testada sem banco: pago ganha
  **baixa automática do que FALTA** na conta padrão (sinal registrado à mão
  não trava mais a baixa, e sem conta padrão ela NÃO inventa uma — anota no
  histórico). **Só que o histórico é onde ninguém olha**: a lojista marcava o
  pedido como PAGO e via a MESMA venda no card "Atrasado", achando que o
  sistema tinha perdido o dinheiro dela (relato de 03/09/2026). Agora o
  painel e o Contas a Receber **DIZEM em vermelho** o que falta configurar,
  com quantas vendas estão esperando — e **escolher a conta padrão REPESCA**
  as vendas pagas que ficaram sem baixa (a porta é chamada de novo, é
  idempotente e continua sendo a única a escrever; teto de 50 por rodada, no
  `after()` ao salvar a conta e **de carona** em toda abertura do Financeiro —
  nunca um 3º cron, ADR-002). A repescagem pega a venda com **saldo em
  aberto** (a paga com sinal registrado à mão também) e **só o que a porta VAI
  resolver**: fica de fora a parcela em que alguém ESTORNOU à mão (a varredura
  roda sem ninguém pedir, e desfaria o estorno em segundos) e o pedido que
  mudou de valor tendo baixa à mão viva (esse a porta só avisa, e ficaria na
  fila para sempre, empurrando para fora do teto os casos que têm conserto).
  Isso é da VARREDURA: numa transição de verdade do pedido a porta continua
  baixando o que falta, como sempre — o que muda é que ninguém varre o
  passado por conta própria. E a baixa da porta, quando já existe, é
  **AJUSTADA, nunca duplicada**: criar a segunda pagava a venda duas vezes;
  desistir na recusa do índice deixava a parcela com saldo aberto para sempre
  (o sinal à mão estornado depois da baixa automática). O quanto ajustar é
  lido na hora, do banco — somar um valor que envelheceu numa corrida
  dobraria o dinheiro —, e a baixa que muda de valor SOLTA a conciliação
  (RN-037); voltar para aguardando **estorna só a baixa DELA**; cancelar
  **ou voltar a ORÇAMENTO** desfaz e cancela (senão ficaria dinheiro que
  nunca entrou no extrato); e o **valor acompanha o pedido** — pedido de R$
  100 editado para R$ 450 refaz o lançamento e a baixa, porque o automático
  não aceita edição na tela (RN-030). **O QUE A LOJISTA FEZ NA MÃO É DELA**:
  baixa manual e cancelamento manual nunca são desfeitos — a porta avisa no
  histórico (uma vez, sem virar spam) e para. **Pedido APAGADO cancela o
  lançamento** (estorna a baixa automática; com baixa manual, fica e avisa) —
  e a porta confere antes que o pedido sumiu MESMO, porque o after() dispara
  até quando a exclusão falha. **Corrigir a DATA da venda é ato
  EXPLÍCITO** (`corrigirDataDaVendaNoFinanceiro`, só a tela de corrigir data
  chama): move competência, vencimento e a baixa automática numa transação e
  solta a conciliação da baixa movida (RN-037); a baixa manual fica com a
  data em que o dinheiro andou. **Pagamento atrasado NÃO muda competência**:
  a venda de agosto paga em outubro continua resultado de agosto (RN-036) —
  só a data da baixa é de outubro. **A porta é chamada em TODA porta de edição, não
  só na troca de status** (03/09/2026): editar itens, desconto, acréscimo ou
  frete respondia ANTES da chamada, e o lançamento ficava congelado no valor
  antigo — o pedido valia R$ 553,50 e a conciliação seguia oferecendo
  R$ 554,50 para casar com a linha do banco. A varredura de carona também
  deixou de olhar só a venda paga SEM baixa: acerta agora a venda cujo
  **valor diverge** do pedido (`vendasComValorDivergente`), que é o que
  conserta sozinho o que já ficou torto — ninguém vai reeditar pedido antigo
  só para o número se ajustar. Continua de fora quem tem baixa VIVA
  registrada à mão (ali a porta só avisa, e repescar seria trabalho que não
  muda nada em toda abertura da tela).
  **Unificar contatos leva o financeiro junto**: lançamentos e
  contas fixas da ficha apagada passam para a que sobrevive, senão a
  inadimplência virava "Sem cliente" e a cobrança perdia o WhatsApp.
  **TODO caminho que muda o valor do pedido passa pela porta** (auditoria de
  03/09/2026): o PATCH do pedido tem três respostas — "só itens", "só
  valores" e a geral —, e duas delas saíam antes de avisar o financeiro,
  justamente as que os editores de itens e de valores usam: o pedido de R$
  100 virava R$ 450 e o lançamento ficava R$ 100 para sempre. Pedido que
  passa a **não custar nada** (desconto de 100%) tem o lançamento CANCELADO,
  em vez de o valor zero ser ignorado e a porta baixar o valor velho.
  **ESTORNAR também é fazer na mão**: depois que a lojista estorna uma baixa
  (o Pix voltou), a porta não repõe o dinheiro — antes bastava mudar o pedido
  de PAGO para ENVIADO e ele reaparecia sozinho no extrato. A venda entra
  pelo `total` (o que a cliente paga, **frete-ok**; faturamento continua `netTotal` por
  RN-002), com a categoria da origem (atacado, varejo, loja online) e as
  datas ao **meio-dia UTC** (RN-030 — carimbo cru some do filtro do mês).
  A **etiqueta do Melhor Envio vira despesa de frete já baixada**, chaveada
  pelo `meOrderId` (a COMPRA, não o envio: recomprar de PAC para SEDEX é
  outra despesa), e **cancelar a etiqueta estorna e cancela a despesa** — o
  valor voltou para a carteira ME. **NUNCA ATRAPALHA A VENDA E NUNCA SOME**:
  o trabalho vai no `after()` do Next — chamada solta seria congelada pela
  Vercel junto com a resposta, e a venda paga desapareceria do financeiro sem
  erro nenhum. Loja sem o módulo (RN-029): a porta sai calada.
  **RN-034 · COBRAR PELO WHATSAPP** (`lib/financeiro/cobranca.ts`, tela
  `/financeiro/inadimplencia`): é o que um financeiro comum NÃO faz — a lista
  de atrasados existe em todo sistema, e a lojista ainda tinha que sair
  procurando a conversa uma por uma. Aqui a mensagem é MONTADA pelo sistema
  (primeiro nome, valor que falta, vencimento, tom conforme o atraso — nunca
  acusa, sempre abre a porta para a cliente responder) e ENVIADA por uma
  PESSOA clicando, pela Central de sempre, com o ritmo anti-ban da RN-017.
  A mesma conta **não é cobrada duas vezes no mesmo dia** (`cobradoEm`), e a
  porta RECUSA com frase em português quando falta o essencial: sem cliente,
  sem WhatsApp, cliente bloqueada, parcela quitada ou lançamento cancelado.
  Se o envio falhar, **não se diz que foi enviado** — o carimbo de cobrança
  só é gravado depois que a mensagem sai, e "sair" se confere pelo STATUS da
  mensagem: a Central não lança erro quando o provedor recusa, ela devolve a
  mensagem marcada como FALHOU (é o mesmo caminho que faz o ⏱️ virar ⚠️ na
  bolha). Sem olhar o status, a cobrança se dava por enviada com o WhatsApp
  desligado — a lojista riscava da lista e a cliente nunca soube.
  **RN-035 · A VISÃO DE DONO** (`lib/financeiro/visao.ts`, `/financeiro` e
  `/financeiro/dfc`): com o módulo ligado, a tela do Financeiro deixa de ser
  a lista de pedidos a receber e vira o PAINEL — saldo hoje (somado por
  conta), a receber e a pagar do mês, atrasado, e o **saldo previsto** para 7,
  15 ou 30 dias com o termômetro de cobertura. A previsão soma só o que está
  EM ABERTO (o já pago não pode contar duas vezes) e **o atrasado ENTRA**: a
  conta vencida ontem continua sendo dinheiro a receber, e tirá-la faria a
  loja se planejar com menos do que tem. O **DFC** responde "por onde o
  dinheiro andou" com o que MOVIMENTOU nas contas, em três blocos
  (operacional / investimento / financiamento, pelo CÓDIGO da categoria — o
  código é do sistema, o nome é da loja, então renomear não quebra o
  relatório; categoria criada pela loja cai em operacional). O teste de
  honestidade fica na tela: saldo inicial + gerado + **saldo das contas
  cadastradas no período** + transferências = saldo final, e a diferença é
  DITA, nunca escondida (RN-032) — **cada uma com o nome CERTO**: conta
  cadastrada com saldo inicial DENTRO do recorte traz dinheiro que a loja não
  gerou nem transferiu, e ele caía na sobra chamado de "transferência". Dizer
  o nome errado do dinheiro é pior que não mostrar.
  A árvore de categorias ganhou o bloco **07 · Investimentos** e a semeadura
  passou a COMPLETAR o que falta — sem isso a loja antiga nunca veria o bloco
  novo e o DFC dela nasceria torto.
  **RN-036 · DEU LUCRO ≠ TEM DINHEIRO** (`lib/financeiro/relatorios.ts`, telas
  `/financeiro/dre` e `/financeiro/fluxo-de-caixa`): são duas perguntas
  diferentes, e é por não separá-las que loja lucrativa quebra. O **DRE** é
  por **COMPETÊNCIA** — a venda de agosto é resultado de agosto, mesmo que a
  cliente pague em outubro (o valor é o do LANÇAMENTO, então venda em 3× é
  resultado inteiro do mês da venda) — e sai mês a mês por categoria, com
  receita → custo da mercadoria → **lucro bruto** → despesas → resultado, tudo
  com % sobre a receita e montado sozinho pelo CÓDIGO da árvore (RN-029; 01/02
  receita, 03 custo, 04 venda, 05 administrativa, 06 financeira, categoria da
  loja entra pelo TIPO). **Investimento (07) fica FORA do resultado e é DITO
  na tela**: comprar uma máquina de R$ 8.000 não é prejuízo, é dinheiro que
  virou máquina — somá-lo faria um mês bom parecer desastre; o efeito no caixa
  aparece no DFC. O **Fluxo de Caixa** é a outra conta: pela **data do
  dinheiro**, meses nas colunas, agrupável por categoria (padrão), cliente,
  fornecedor ou coleção, e com três recortes — realizado, previsto e o
  **misto** (padrão): o realizado vale sempre e o previsto entra só do mês
  corrente para frente — previsto no passado inventaria dinheiro que já se
  sabe que não entrou, e o mês em curso soma os dois (o que já entrou mais o
  que falta). Do previsto entra só **o que FALTA** (a parte já paga já entrou
  pelo realizado — contar as duas dobraria a venda) e a **conta ATRASADA não
  some**: ela cai no mês corrente, que é quando a loja vai correr atrás
  (mesma régua do saldo previsto, RN-035) — inclusive a que venceu antes do
  período, buscada com teto próprio e só quando o mês corrente está nas
  colunas. O saldo do primeiro mês é o saldo REAL da loja (RN-032), com cada
  mês começando onde o anterior terminou. O agrupamento por cliente,
  fornecedor ou coleção usa o **ID como chave, nunca o nome**: as duas "Maria
  Silva" da loja (RN-020) viravam uma linha só. E o **corte de 24 colunas é
  DITO na tela** — pedindo 2020–2026 a lojista via 24 meses, os filtros
  mostrando o período inteiro e nenhum aviso, concluindo que 2022–2026 não
  teve movimento. Categoria "07" criada pela LOJA não é investimento (só a da
  árvore do sistema é): a despesa real dela sumia do resultado.
  **RN-037 · CONFERIR COM O BANCO** (`lib/financeiro/ofx.ts` +
  `lib/financeiro/conciliacao.ts`, tela `/financeiro/conciliacao`): o extrato
  que o banco exporta (OFX) de um lado, o que a loja registrou do outro. Três
  decisões sustentam tudo. **Quem diz que é o mesmo movimento é o BANCO**: o
  `FITID` de cada linha é o identificador dele, e o único (loja, conta, fitid)
  faz reimportar o mesmo arquivo — ou dois arquivos que se sobrepõem, que é o
  normal — não duplicar nada. **O casamento óbvio é feito sozinho** (mesmo
  valor com o sinal certo, data dentro de 3 dias) e fica marcado como
  automático, mas **só quando a resposta é ÚNICA dos dois lados**: duas baixas
  de R$ 300 no mesmo dia são exatamente onde o palpite erra, e conciliar
  errado é pior que não conciliar. **Um depósito pode pagar VÁRIAS parcelas**,
  então o vínculo é tabela própria e a conciliação só fecha quando os dois
  lados **somam igual** — o "quase igual" é o erro que a tela existe para
  achar. A mesma baixa não se concilia duas vezes (único por baixa) e
  estornada não se concilia. **Conciliar NUNCA mexe em dinheiro que já existe**: não cria,
  não altera e não apaga baixa — carimba "conferido"; linha que não é do
  sistema (tarifa que a loja não lança) se marca como fora e volta para a
  fila quando quiser — e **baixa estornada solta a conciliação** (nas duas
  portas de estorno): linha "conferida" contra dinheiro que voltou atrás
  faria a conferência do mês fechar com um erro impossível de achar. O
  casamento automático roda sobre TODAS as linhas pendentes da janela, não
  só as do arquivo que acabou de entrar: linha que ficou sem par casa quando
  o lançamento aparece, e subir o mesmo arquivo de novo continua conciliando
  o que dá. Os dois sabores do arquivo entram pelo mesmo leitor
  (OFX 1.x é SGML, com tag que não fecha; 2.x é XML), a data ignora o fuso
  colado, o texto vem em windows-1252 quando o cabeçalho diz, e movimento sem
  FITID/data/valor é descartado e CONTADO (a tela avisa; linha ilegível calada
  faria a lojista fechar a conferência com o extrato divergindo) — 19 linhas
  certas valem mais que 20 com uma inventada. **Dia que não existe no
  calendário** ("20260231") também é descartado AQUI: antes ele passava e só
  era recusado na gravação, derrubando a importação inteira com 500 e
  deixando o registro do arquivo órfão. E quando o separador vem com **três
  casas** ("123.450" pode ser cento e vinte e três mil ou R$ 123,45 — o
  padrão OFX permite três casas), **quem desempata é o ARQUIVO INTEIRO**, a
  mesma régua do acento: um separador com duas casas em qualquer movimento
  prova qual é o decimal daquele banco. Errar aqui multiplicava o valor por
  MIL, e a linha ficava eternamente a conferir sem nenhum aviso, porque tinha
  sido lida "com sucesso". Quem decide o acento é o
  CONTEÚDO, não o cabeçalho (banco que exporta UTF-8 dizendo `CHARSET:1252`
  existe), e o valor aceita separador de milhar dos dois formatos. **O arquivo em si não é guardado** (dívida técnica nº 1): dele
  saem as linhas, que é o que a conciliação usa.
  **A CONTA EM ABERTO APARECE NO PAINEL** (auditoria de 03/09/2026): as
  candidatas eram só BAIXAS, então a venda de R$ 1.500 registrada e ainda não
  recebida ficava invisível — e o texto da tela mandava usar o "Lançar",
  criando uma SEGUNDA receita do mesmo dinheiro (receita em dobro no DRE, a
  parcela original virando atrasada, e a cobrança da RN-034 indo atrás de
  dinheiro que já entrou). Agora ela aparece num bloco próprio com o botão de
  registrar o recebimento: um clique, e aí sim ela vira candidata e a linha
  fecha. Conferir continua sem quitar nada sozinho.
  **A LINHA QUE O SISTEMA NÃO TINHA VIRA LANÇAMENTO NA HORA** (03/09/2026):
  antes a lojista tinha duas saídas ruins — marcar "fora do sistema" (e o
  dinheiro sumia do DRE e do fluxo) ou sair da conferência, abrir Contas a
  Pagar, lançar, voltar e procurar a linha de novo; na terceira vez ela
  desiste da conciliação. Agora o botão abre a **ficha completa de sempre**
  (RN-030, mesmo validador — parcelas, categoria, centro de custo, coleção)
  já com o valor, a data e a conta que o BANCO informou, e o lançamento nasce
  **baixado e conferido** com aquela linha. É a ÚNICA porta da conciliação
  que registra baixa, e é o certo: aqui o extrato do banco está dizendo que o
  dinheiro andou — o que segue proibido é o botão "Conferir" quitar conta que
  já existe (dar por recebida uma venda que ninguém pagou). O **lado tem que
  bater com o sinal** do banco (entrou = conta a receber), o dinheiro vai
  baixando as parcelas em ordem sem nunca passar do valor de cada uma, e a
  transação é **SERIALIZÁVEL** — duas abas criando da mesma linha fariam o
  mesmo dinheiro entrar dobrado. A ficha tem que **COBRIR A LINHA INTEIRA**:
  cobrindo menos, a versão anterior criava a baixa sem vínculo nenhum, e aí
  nada detectava o reenvio da mesma ficha (a lojista clica de novo depois de
  um erro de rede e o dinheiro entra duas vezes) e a baixa solta virava
  candidata do casamento automático seguinte, carimbada contra OUTRA linha do
  banco. O depósito que pagou duas contas continua tendo caminho, e é o de
  sempre: lançar as duas e marcar as duas no "Conferir". Linha de R$ 0,00 não
  vira lançamento (nenhuma ficha soma zero). Do outro lado, achar a venda certa entre 200 baixas era
  o trabalho manual que sobrava: com uma linha escolhida, as que **COMBINAM**
  (mesmo valor, data pertinho) sobem para o topo com ✨ e a **busca** acha
  pelo nome da cliente ou pelo número do pedido.
  **RN-038 · NOTA E COMISSÃO NO FINANCEIRO** (`lib/financeiro/nota-do-lancamento.ts`
  e `lib/financeiro/comissoes.ts`): duas pontas soltas que faltavam. A ficha
  do lançamento que veio de PEDIDO agora **mostra a nota** (situação, número,
  link do DANFE e o pedido de origem) e, com o Bling conectado, emite dali
  mesmo — pela MESMA porta do pedido: **quem emite continua sendo o Bling**
  (RN-016), o financeiro só mostra o caminho; nota AUTORIZADA não se emite de
  novo (viraria nota em dobro), a que deu ERRO pode. E a **comissão vira
  CONTA A PAGAR** num clique na tela de Comissões: sem isso a lojista via
  "sobrou R$ 4.000 no mês" sem lembrar das comissões que ainda vai pagar — a
  segunda maior despesa de uma loja de atacado. A conta nasce da MESMA fonte
  da tela (pedidos pagos, `commissionBase` da loja, percentual da vendedora;
  frete nunca entra, RN-002) e **não paga duas vezes**: a chave
  `vendedora:início:fim` é única no banco, gerar o mesmo período devolve a
  conta que já existe e período que **ENCOSTA** num já gerado é RECUSADO
  dizendo qual — mudar um dia no filtro pagaria o mesmo mês de novo. **Só
  período FECHADO vira conta a pagar**: com o mês em curso, a venda da tarde
  entraria no período registrado e ficaria fora do valor. Comissão CANCELADA
  pode ser lançada de novo (a chave ganha sufixo — o único do banco vale para
  cancelado também, e sem isso a lojista cancelava, como a mensagem manda, e
  nunca mais lançava aquele período), e a tela só marca "✓ lançada" no período
  IGUAL: uma quinzena gerada avisa que cruza, em vez de esconder a outra
  metade do mês.
  **RN-039 · CARTÃO DE CRÉDITO** (`lib/financeiro/cartao.ts` +
  `cartao-fatura.ts`, tela `/financeiro/cartoes`): a conta do cartão **NÃO
  guarda dinheiro** — ela junta compras numa FATURA. É essa a diferença que
  faz a conta bater: a compra de hoje no cartão é despesa de hoje (entra no
  DRE do mês certo), mas o dinheiro só sai do banco no vencimento da fatura;
  lançar a compra como saída do banco no dia da compra é o erro clássico — o
  extrato passa a divergir e o fluxo mostra dinheiro saindo num mês em que ele
  ficou. A loja cadastra o cartão com o **dia em que fecha e o dia em que
  vence**, e a compra cai sozinha na fatura certa (comprou no dia do
  fechamento ou depois, vai para a próxima; parcelado entra numa fatura por
  mês; dia 31 em mês curto cai no último dia, RN-030). **Pagar a fatura dá
  baixa em TODAS as compras dela de uma vez**, na conta de onde o dinheiro
  sai — 40 compras baixadas uma a uma é onde a lojista desiste do financeiro
  —, em transação SERIALIZÁVEL e sem repagar o que já estava pago. Cartão
  **nunca vira a conta padrão** (nem ao virar cartão numa edição): a porta
  única de entrada das vendas (RN-033) baixaria a venda paga no cartão de
  crédito da loja. E o cartão **não aparece onde o dinheiro anda** — baixa e
  transferência —, senão daria para quitar a parcela fora de qualquer fatura.
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
- Dívidas mapeadas: blob storage para fotos e arquivos (é ele que impõe o
  teto de ~12MB da RN-028 — a única exceção declarada ao "se a cliente
  mandou, tem que chegar"); conferir `INTAKE_SECRET` na Vercel; quebrar telas
  gigantes (`inbox.tsx` ~2,4k linhas) em componentes menores. O rate-limit no
  login SAIU da lista: já existe (`lib/rate-limit.ts`, com trava antes da
  consulta, contagem antes de conferir a senha e senha falsa para o login
  inexistente não virar detector de contas).
- **Auditoria do WhatsApp (31/08/2026)**, pedida antes de o módulo virar base
  de um produto novo: nasceram a RN-028 e o ADR-015 (arquivo que não se
  perde) e a porta do WhatsApp oficial virou fail-closed. **Grupos (`@g.us`)
  continuam sendo descartados na porta de propósito** — aqui cliente é uma
  pessoa com telefone. Produto que precise de grupo tem aí a sua primeira
  obra.
- Auditoria completa (segurança + métricas) feita em 24/07/2026 — métricas
  unificadas na fonte única; isolamento multi-tenant verificado rota a rota.
