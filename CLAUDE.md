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
   **`CREATE INDEX CONCURRENTLY` = UMA instrução por arquivo de migração**
   (10/09/2026): várias instruções mandadas juntas rodam dentro de uma
   transação implícita do Postgres, e CONCURRENTLY é proibido ali (erro
   25001). A migração falha inteira, fica marcada como falhada e **PARA todos
   os deploys seguintes** (P3009) — foi o que aconteceu com
   `20260909181000`, que trazia dois índices no mesmo arquivo. O destravador
   (`scripts/migrate-deploy.mjs`) cobre os dois casos: a migração
   reexecutável ele repete; a que não tem conserto por repetição ele carimba
   como aplicada, e só quando o efeito dela já vem por outra migração.
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
  **RN-064 · A sessão RENOVA sozinha enquanto a pessoa USA o sistema**
  (`lib/sessao.ts` + porteiro global, 23/09/2026): o login valia 7 dias
  CRAVADOS e vencia no meio do trabalho — relato da Entre Linhas cadastrando
  produtos: tudo preenchido e o salvar respondendo "Não autenticado" (a tela
  de Produtos vive no navegador, então o salvar é a PRIMEIRA ida ao
  servidor; a pessoa descobre que caiu na hora que mais custa). Agora o
  porteiro REASSINA o cookie quando o crachá passa de 1 dia de idade, com os
  mesmos 7 dias: quem usa não é derrubada; a sessão vence com 7 dias PARADA
  ou no **teto de 30 dias desde o login** (carimbo `auth`, que a renovação
  preserva — sem o teto, cookie roubado ou a aba esquecida na loja, que o
  sync de 3s mantém "em uso", virava sessão eterna, achado da revisão). As
  outras travas: **impersonação não renova** (a sessão de suporte do Super
  Admin vence em 7 dias como sempre); **logout e impersonação não recebem
  renovação por cima** (`rotaMexeNaSessao` — dois Set-Cookie da mesma sessão
  na mesma resposta têm vencedor dependente da plataforma, e o "Sair" podia
  sair sem sair, achado da revisão); **renovar não reabre porta nenhuma** (o
  cookie só prova quem é — usuária desativada e loja suspensa seguem
  barradas no `getSessionUser`, a cada requisição); **crachá torto não
  renova** (sem `sub`, sem `iat` ou com `iat` no futuro fica como está).
  Assinatura e atributos do cookie têm UMA função (login e renovação): claim
  novo de sessão entra lá, senão a primeira renovação o apagaria. E o 401 na
  área de Produtos fala português (`avisoDaRecusa`), distinguindo os dois
  casos: o 401 do porteiro leva a marca `sessao: "vencida"` e vira "entre em
  OUTRA aba e volte para salvar" (o login em outra aba renova o cookie do
  navegador inteiro e o digitado não se perde); o 401 SEM a marca (usuária
  desativada, loja suspensa) diz para falar com quem administra — mandar
  essa pessoa para a outra aba seria um beco (achado da revisão).
  **RN-066 · A TELA QUE QUEBROU SE RECUPERA — E CONTA O QUE HOUVE**
  (`lib/erro-da-tela.ts` + `components/tela-de-erro.tsx`, `app/error.tsx`,
  `app/(app)/error.tsx` e `app/global-error.tsx`, 23/09/2026): relato do
  dono com print do iPhone — o app aberto por muito tempo voltava com a
  frase crua do Next em inglês ("Application error: a client-side exception
  has occurred"), sem botão. O app **não tinha tela de erro nenhuma**.
  Agora tem, em quatro decisões (duas revisões, 18 achados): (1) **"versão
  velha" recarrega SOZINHA, com trava** — o pedaço de código que só existia
  na versão aberta no aparelho não está mais no servidor (`ChunkLoadError`
  e as frases de carregamento de cada navegador, o Safari incluso;
  `pareceVersaoVelha` olha SÓ isso, erro comum que cite "chunk" não conta).
  A trava é **por aba, em dois degraus**: no máximo uma recarga por minuto
  E no máximo 3 em meia hora (só o primeiro degrau recarregava a cada
  minuto para sempre quando a peça faltava de verdade), gravada e **lida de
  volta antes** de recarregar — sem conseguir gravar, NÃO recarrega; carimbo
  no FUTURO é descartado (o iPhone que dormiu acerta o relógio para trás ao
  acordar, e o carimbo travava a aba para sempre). **Sem internet não
  recarrega**: no app instalado do iPhone, recarregar offline dá a tela
  branca do sistema, sem botão — a tela diz "sem conexão", recarrega quando
  o evento `online` chega e mostra o botão mesmo assim (se o evento nunca
  vier, não vira beco); (2) **qualquer outro erro NUNCA recarrega
  sozinho**: mostra em português que algo deu errado, que o salvo continua
  salvo, o botão (com aviso se estiver sem internet) e o detalhe técnico
  miúdo — é o que chega no print. Recarregar às escondidas sumiria com
  defeito de verdade, e quem acabou de clicar "salvar" precisa saber;
  (3) **dentro do app o menu FICA** (`(app)/error.tsx`): com o boundary só
  na raiz, o menu sumia e o único botão levava de volta à mesma tela
  quebrada. A raiz (`app/error.tsx`) pega o catálogo, a bio e o próprio
  esqueleto do app; o `global-error` traz `<head>` com o viewport escrito à
  mão (sem ele o iPhone desenharia a tela de socorro miúda) e os estilos da
  tela são escritos nela, com a cor de reserva — o CSS do app pode não
  estar de pé; (4) **o erro é CONTADO ao painel de Saúde**
  (`/api/erro-da-tela` → `ErrorLog`). Não é enfeite: o Next 15 **já
  recarrega sozinho** quando a NAVEGAÇÃO encontra versão nova (conferido
  em `fetch-server-response.js`), então "versão velha" é suspeita, não
  certeza — e consertar no escuro já custou caro (Bling, três tentativas).
  O relato é montado DEPOIS da decisão e diz se a recarga **aconteceu**:
  só a versão velha que recarregou é o caso esperado (fonte `tela.versao`,
  **fora da lista e da conta de erros** da Saúde e da Gestão — a Saúde
  mostra uma linha cinza com quantas foram); a que a **trava barrou** é
  peça faltando de verdade e entra como quebra (`[tela · peça que não
  carregou]`) — arquivá-la como "se curou" escondia justamente o defeito
  que a trava existe para expor. Erro que veio do **servidor** (tem
  `digest`) não é relatado de novo: o `onRequestError` já o registrou. O
  relato fica no aparelho (localStorage, um só, vale 7 dias) e sai **só com
  login** (`EnviarRelatoDeErro`, no layout da área logada): ao montar e
  **na hora** em que uma tela do app quebra sem recarregar (evento — o app
  instalado fica aberto por dias sem carregamento completo, e a quebra
  seguinte apagava a anterior). Quem quebrou com a sessão vencida recarrega,
  entra, e aí ele sai — o 401 NÃO apaga o relato, e a porta não vira
  escrita pública no banco. O envio usa `keepalive` (a página pode estar
  recarregando) e cada relato tem um **id sorteado**: o servidor não grava o
  mesmo id duas vezes. **Limite aceito**: quebra do catálogo no celular da
  CLIENTE final nunca chega ao painel (ela não tem login). **Os códigos de
  acesso moram no CAMINHO**, não só na busca — `/dados/<token>` escreve na
  ficha da cliente, `/ficha/<código>` abre o RH, `/catalogo/<loja>/l/<código>`
  é o link de atacado sorteado —, então TODO parâmetro dinâmico da rota
  vira o nome dele (`/dados/[token]`, `caminhoSemCodigos`, com os
  parâmetros dados pelo próprio Next em `useParams`; sem eles, fica só o
  primeiro pedaço); busca e `#` saem no aparelho E de novo no servidor.
  Quem é a pessoa e a loja vem da SESSÃO, nunca do corpo; ritmo de 10
  relatos por pessoa a cada 15 min (`errotela:`). **Tela quebrada NÃO toca
  o alarme "🚨 Erro em produção"** (`logServerError` com `alarme: false`):
  ele é o canal ÚNICO das emergências do servidor e do WhatsApp, com um
  intervalo de 15 min compartilhado — um relato de tela ganharia esse
  intervalo e calaria o alarme de uma mensagem de cliente perdida, e o
  texto vem do aparelho, digitável por quem estiver logado em qualquer
  loja. A quebra aparece na conta de erros da Saúde. A cura de raiz do
  caso "versão velha" é a **Skew Protection da Vercel** (Settings →
  Advanced, plano Pro) — é um botão do dono; o código só se recupera.
  **RN-095 · A ABERTURA QUE NÃO TERMINA NÃO FICA BRANCA**
  (`lib/vigia-da-abertura.ts` no `<body>` do layout raiz, `public/sw.js` +
  `components/registrar-sw.tsx`, 23/10/2026, ADR-022): relato do dono —
  *"outra cliente foi tentar acessar o aplicativo pelo celular, pela
  Starlink do carro, e a tela fica toda branca… já é o segundo cliente"*. A
  RN-066 não alcança esse caso, e a bancada mostrou por quê
  (`scripts/bancada-tela-branca.mjs`, Chromium com prints): em TODO cenário
  em que a página CHEGA — sem JavaScript, sem CSS, sem os pedaços de código
  — há algo na tela; o branco total só aparece quando a página **não chega
  ou chega CORTADA**. E cortada é fácil: no celular, o primeiro pedaço
  visível (o esqueleto de carregamento) só vem por volta de **25% do
  arquivo** — tudo antes dele é o menu lateral, escondido no celular. A
  conexão que cai entre 3% e 25% (troca de satélite, túnel) deixa o
  navegador com o fundo e nada mais, **para sempre, sem erro e sem botão**
  — a tela de socorro é JavaScript, e o JavaScript nunca chegou. Três
  peças: (1) **o vigia viaja nos PRIMEIROS bytes**: script miúdo em
  JavaScript antigo, primeiro filho do `<body>` (chega junto com o `<head>`,
  a ~3%), sem dependência nenhuma, que observa o **marcador** que o layout
  raiz põe como ÚLTIMO filho do `<body>` (`ID_FIM_DA_PAGINA` — o esqueleto
  da página chegou inteiro). **Só fala com CERTEZA**: a página terminou
  (`load`) sem o marcador e sem nada visível → aviso na hora; o download
  **PAROU** — nenhum nó novo chegou, medido pela contagem de nós, não pelo
  relógio: num link de 15 kbps a página demora mas anda, e um aviso ali
  faria a pessoa recomeçar do zero (achado da revisão) — por 12 s sem nada
  visível, ou por 40 s mesmo com algo na tela → aviso; presa no esqueleto
  `aria-busy` do app por 40 s **depois de ele aparecer** → aviso; 60 s sem a
  página inteira, mesmo andando → aviso. "Visível" é texto, imagem, botão ou
  caixa pintada — um contêiner vazio com altura NÃO conta, é a própria tela
  branca (a primeira versão contava, e o aviso nunca saía). O aviso é em
  português, com o botão "Tentar de novo", e **nunca recarrega sozinho com
  internet** (a régua da RN-066); **sem internet** diz "sem conexão", mostra
  o botão e recarrega UMA vez no evento `online` (o caso do app instalado do
  iPhone, que offline mostra branco sem botão). Se a página terminar de
  chegar depois do aviso, ele some. **Depois que a página chegou inteira, o
  vigia se cala para sempre**: a navegação seguinte dentro do app (mesmo
  esqueleto) e a tela de socorro da RN-066 (troca o corpo e leva o marcador)
  não são assunto dele — sem isso, a navegação lenta aos 45 s ganhava o
  aviso errado (achado da revisão). Um laço só, a cada 2 s (o `load` confere
  na hora, sem abrir um segundo relógio). (2) **O service worker passa a
  existir em todo aparelho logado** (antes só quem ligava as notificações de
  venda o tinha) e ganha UMA tarefa nova: quando a **navegação não alcança o
  servidor** (a promessa do `fetch` rejeita — sem internet, rede caída),
  responde a página "Sem conexão" **escrita no próprio arquivo**, com o botão
  e a volta automática no `online` em HTML puro. **Rede primeiro, sempre, e
  NENHUM cache**: resposta do servidor (200, 404, 500) passa como veio —
  assim não existe "versão velha servida pelo service worker", o defeito
  clássico de app instalado (ADR-022); e a página de reserva não é guardada
  do app porque, guardada, ela precisaria do código do React para o botão
  funcionar, e offline esse código não vem — a primeira versão tinha uma
  página `/offline` em cache com botão morto (achado da revisão). Só
  navegação, só a própria origem; API, fotos e código seguem direto; e a
  navegação sai em paralelo com a partida do worker (`navigationPreload`),
  senão cada abertura esperaria o worker acordar. O catálogo público NÃO
  registra o service worker (o navegador de dentro do WhatsApp muitas vezes
  nem tem) — lá quem segura a tela branca é o vigia. (3) **Fica CONTADO**: o
  vigia guarda o relato no aparelho pelo MESMO caminho da RN-066
  (`CHAVE_RELATO_PENDENTE`, com a marca `abertura: true`; não sobrescreve um
  relato de quebra de código que espera para sair) e o `EnviarRelatoDeErro`
  o manda no próximo carregamento que der certo, com login. A fonte é
  própria (`tela.abertura`): é a conexão da pessoa, não o código — **fora da
  conta de erros** da Saúde e da Gestão, mas em **bloco próprio** na Saúde
  ("Telas que não terminaram de carregar", 7 dias, com caminho, navegador e
  se tinha internet), para se SABER quantas aberturas falham e de onde —
  muitas da mesma loja ou do mesmo navegador são pista. **Limites ditos**: o
  vigia só vê a página que CHEGOU em parte; a que não chegou nada é do
  service worker (só em aparelho que já abriu o app logado uma vez e tem
  suporte) ou do navegador; o relato da cliente final do catálogo nunca
  chega (não tem login, a régua da RN-066); e a causa de REDE da cliente
  (Starlink em movimento, bloqueio por navegador) não se conserta daqui — o
  que se conserta é a tela muda. Provado pelo script em jsdom
  (`vigia-da-abertura.test.ts`, o script de verdade com relógio falso) e
  pela bancada no Chromium contra o build de produção local.
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
- **RN-069 · VENDA A PRAZO — "ENTREGUE · A RECEBER"** (`OrderStatus.ENTREGUE_A_RECEBER`,
  `lib/orders.ts`, 03/10/2026): pedido do dono — *"tem gente que compra hoje e
  só paga mês que vem, mas já está com o produto"*. Decidido com ele: é
  **venda a prazo** (comprou, não devolve — "condicional", que permite
  devolução, é outra coisa e NÃO é isto), **comissão na entrega**, e **não é
  faturamento até virar pago** (não contar dinheiro que não entrou). Então:
  (1) o status fica **FORA de `PAID_ORDER_STATUSES` de propósito** — RN-001
  intocada; a venda entra em Vendas/Relatórios no mês em que virar PAGO (pela
  data do pagamento), enquanto o DRE do Financeiro a mostra por competência
  no mês da venda — os dois números são verdadeiros, respondem perguntas
  diferentes; (2) **estoque**: segura/baixa como todo pedido (RN-003) e conta
  como **"saiu da loja"** no Estoque (fora de `STATUS_QUE_SEGURAM_NA_LOJA`) e
  da fila da Separação; (3) **financeiro**: é irmão do "aguardando pagamento"
  na porta única (`A_RECEBER_STATUSES` — "vale dinheiro, não recebido"):
  nasce **conta a receber em aberto, sem baixa**, com **vencimento 30 dias
  depois da entrega** (`vencimentoDaVendaAPrazo`; sem isso nascia "vencida
  hoje" e a cliente caía na Inadimplência no dia em que levou) — aparece em
  Contas a Receber, no Fluxo previsto e, vencida, na Inadimplência com a
  cobrança pelo WhatsApp (RN-034); o pedido que já estava "aguardando" e
  virou a prazo tem o vencimento movido para o combinado (só a parcela sem
  baixa viva, de forma idempotente); virar PAGO dá a baixa automática do que
  falta; voltar de pago para a prazo estorna só a baixa automática;
  (4) **comissão NA ENTREGA** pela lista `COMMISSION_ORDER_STATUSES`
  (faturamento + este status — a ÚNICA lista que difere da de faturamento, de
  propósito), com **data ESTÁVEL**: `Order.entregueAReceberEm` é carimbado ao
  entrar no status e **nunca apagado** — a venda entregue em setembro e paga
  em outubro conta comissão em setembro, e NÃO de novo em outubro
  (`whereComissaoNoPeriodo`, uma régua para a tela, a conta a pagar e o
  relatório); (5) **Dashboard** ganha o cartão "Entregue · a receber" (soma do
  `total`, frete-ok — é o que a cliente vai pagar), só quando há venda a prazo
  em aberto — dinheiro na rua fora de "Vendas" precisa de um lugar próprio;
  (6) o funil põe a venda a prazo na etapa Pagamento e as tarefas a tratam
  como "ainda devendo", pelas listas derivadas (a casa já aprendeu que lista
  à mão é onde status novo se perde). **Cinco achados da revisão fecharam a
  regra** (03/10/2026): (a) **exige vendedora para entrar**, e não deixa
  tirá-la depois — a RN-006 ("define a dona antes de faturar") vale para
  "antes de contar comissão", senão o pedido entregue sem dona em setembro só
  ganhava vendedora ao virar pago em outubro e a comissão caía num mês já
  fechado e lançado (RN-038); (b) o pedido **que já era PAGO** e volta para a
  prazo (o Pix voltou) leva no carimbo a **data do pagamento**, não a de hoje
  — a comissão dele já contou naquele mês, e carimbar hoje a faria contar de
  novo; (c) a decisão de **mover o vencimento mora na máquina pura**
  (`moverVencimento` em `decidirAcaoDaPorta`), olhando a baixa que a MESMA
  ação estorna — decidida depois, com a foto de antes do estorno, a transição
  pago → a prazo deixava a parcela vencendo no dia da venda; (d) a **ficha do
  pedido** troca a faixa "reservadas, cancele para liberar" (a peça saiu com a
  cliente; cancelar não a traria de volta) pela faixa "entregue à cliente, a
  receber — vence em dd/mm", e a **trilha de status** só pinta a etapa como
  feita em quem passou por ela (é caminho alternativo, não etapa do pedido
  comum); (e) o **extrato de comissão em PDF** explica a venda a prazo, a
  coluna "contou em" mostra a data que decidiu o período (✱ na entrega) e a
  tabela é cronológica por ela. **Provado pelas rotas de verdade contra o
  Postgres local** (`scripts/e2e-entregue-a-receber.ts`, 7 cenários):
  estoque, financeiro no `after()`, comissão uma vez só, os dois caminhos de
  entrada no status, cancelamento e a trava da vendedora. **Risco aceito e
  dito**: comissão paga na entrega de venda que a cliente nunca pagar.
  **A previsão de recebimento é COMBINADA, com o padrão de 30 dias**
  (`Order.previsaoRecebimentoEm` + `lerPrevisaoDeRecebimento`, pedido do dono
  em 05/10/2026: *"em algum lugar colocar uma previsão de recebimento; caso
  não coloque nada, mantém os 30 dias"*): na faixa laranja da ficha a
  vendedora combina a data ("ela paga dia 20") e o **vencimento da conta a
  receber passa a ser esse dia** — gravado pela porta do pedido (PATCH, só
  no status a receber; fora dele não há conta em aberto para vencer), como
  DIA ao meio-dia UTC (RN-030), com registro na história do pedido, e o
  financeiro acompanha pela porta única (`vencimentoAlvo` lê a previsão;
  `moverVencimento` move a parcela — **o vencimento é do PEDIDO, a baixa à
  mão é da lojista**: o sinal registrado à mão fica com a data dele e a
  parcela vence no dia combinado mesmo assim, senão a cliente ficava
  "atrasada" numa data que ninguém combinou). Tirar a previsão volta aos 30
  dias. Recusado: data antes do dia da entrega, dia que não existe e mais de
  um ano depois. **Ao virar PAGO a previsão é apagada** (cumpriu-se; a
  história do pedido guarda o que foi) — a venda que volta a prazo recomeça
  nos 30 dias, em vez de reaplicar uma data velha e já vencida. **Corrigir a
  data da venda** move competência e baixa automática, mas o vencimento da
  venda a prazo segue o combinado (`corrigirDataDaVendaNoFinanceiro`). Só a
  equipe comercial combina (suporte é barrado no servidor). A régua do dia
  (`diaSP`/`dataDoDia`) mora em `lib/dia.ts`, pura, para a ficha e o
  Financeiro lerem a mesma data. **Limites**: o status
  só se escolhe na ficha do pedido (o pedido não NASCE a prazo — nasce
  orçamento/aguardando e a vendedora o muda ao entregar); nota fiscal segue
  exigindo pedido pago — a saída a prazo deveria ter nota na entrega, decisão
  pendente do dono com o contador.
- **RN-099 · FRETE GRÁTIS É MARCA EXPLÍCITA DA VENDEDORA, NUNCA FRETE ZERO**
  (`Order.freteGratis` + `resolverFreteDoPedido` em `lib/orders.ts` +
  `linhaDoFrete` em `lib/romaneio.ts`, 27/10/2026): pedido do dono — no
  romaneio, *"quando o frete não é colocado, ele é grátis; queria que ficasse
  como frete grátis, destacado e em negrito"* e, no mesmo dia, *"pode ser
  colocado pelo vendedor na tela de pedidos a opção de frete grátis e isso sair
  no romaneio"*. A primeira versão tratou TODO frete zero como grátis e foi
  trocada no mesmo dia: zero sozinho não diz nada (retirada na loja, frete a
  combinar, pedido do catálogo ainda não cotado), e anunciar "GRÁTIS" aí
  prometia o que ninguém decidiu. Agora a caixinha **"Frete grátis (por conta
  da loja)"** existe nas três portas de montar/editar valores (Novo pedido,
  montador da Central e "Desconto, acréscimo e frete" da ficha), e as duas
  informações nunca discordam: **marcar ZERA o frete** (não existe "grátis por
  R$ 20"), **informar frete maior que zero DESMARCA** (o número é a decisão
  mais recente), e quem decide é o servidor, pela mesma função nas duas portas
  (POST e PATCH, inclusive na edição de itens). Só o pedido MARCADO sai
  **"Frete · GRÁTIS"** em negrito e na cor de destaque da loja no romaneio
  (`gratis: true` troca fonte e cor) e em verde na ficha; frete com valor sai
  como sempre; zero sem a marca não vira linha, como antes. A mexida entra no
  histórico do pedido ("frete grátis marcado/desmarcado"), na mesma linha de
  auditoria dos valores; a edição de ITENS que não fala de frete deixa marca
  e valor como estão (resolver sempre podia virar a marca sem linha no
  histórico, achado da revisão). Marcar grátis num pedido que tinha frete muda
  o total a pagar, e isso passa pelo caminho de sempre dos valores (cobrança
  pendente acompanha, Pix/link antigo expira, porta do Financeiro — RN-033;
  provado contra o Postgres local com o módulo ligado: o lançamento acompanha
  R$ 558 → 573 → 558). **Quem marca**: vendedora e gerência; o **suporte é
  barrado no SERVIDOR** para frete e marca (antes só a tela escondia o editor
  e a porta deixava o suporte mudar o frete — achado da revisão; a mesma
  frase dos valores, 403). A caixinha e a linha "Frete · GRÁTIS" moram num
  componente só (`components/pedido/frete-gratis.tsx`) para as três telas, e
  **o número digitado não é apagado ao marcar** — a caixinha tocada sem
  querer e desmarcada devolve o frete (apagar fazia R$ 25 sumirem calados,
  sem marca e sem rastro). A exportação CSV de pedidos ganhou a coluna
  "Frete grátis" (Sim), para separar o grátis do "não informado". **Limites
  ditos**: o pedido do catálogo nasce sem a marca (a vendedora marca ao
  conferir); a **loja online (Nuvemshop) traz o frete de lá** — a ficha
  esconde a caixinha e o servidor recusa marcar (409): zerar um frete que a
  cliente pagou lá faria o romaneio mentir.
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
  venda, uma baixa. **Pedido cancelado tem dois botões na lista**
  (`pedidos/acoes-cancelado.tsx`, pedido do dono em 07/10/2026): **"Restaurar
  como orçamento"** passa pela porta de sempre do pedido — volta a SEGURAR o
  estoque como pedido novo (recusa com frase se a peça já foi vendida para
  outra cliente), e cancelar de novo volta a perguntar se devolve ou baixa de
  vez; o cancelado com baixa definitiva não desconta de novo. **"Recuperar
  venda"** abre a conversa da cliente na Central com a mensagem sugerida já
  no campo (`mensagemDeRecuperacao` em `lib/recuperar-venda.ts`, o mesmo
  caminho do "Conversar" da Agenda) — a vendedora revisa e manda, nada sai
  sozinho. Provado contra o Postgres local: 8 → 5 (criou) → 8 (cancelou
  devolvendo) → 5 (restaurou) → 5 (cancelou baixando) → 5 (restaurou, sem
  descontar de novo) → 8 (cancelou devolvendo) → 409 ao restaurar com a peça
  vendida no meio.
  **RN-073 · TROCA DE PEÇAS É REGISTRO PRÓPRIO — O PEDIDO NÃO MUDA**
  (`lib/troca/regra.ts` + `lib/troca/registrar.ts` + `lib/troca/credito.ts`,
  bloco "Trocas" na ficha do pedido, 08/10/2026): pedido do dono — *"estou
  tendo muita troca nos produtos; como realizar essas trocas de forma mais
  simples no sistema, levando em conta a integração com a Nuvemshop"*.
  Decidido com ele: frete **combinado** (texto livre, fora da conta);
  diferença a favor da cliente vira **crédito OU devolução** ("os dois");
  troca por **modelo diferente** permitida; **a vendedora registra** (sem
  link para a cliente); e *"no pedido do cliente deve haver o registro de
  trocas como histórico"*. Então a troca é uma **linha própria pendurada no
  pedido** (`Troca` + `TrocaItem`, com retratos das peças), em três passos —
  o que VOLTA (por peça do pedido, com destino **estoque** ou **defeito**),
  o que SAI (pela grade cor × tamanho da RN-062; o preço sugerido é o que o
  MESMO modelo custou no pedido — a troca mais comum é de tamanho — e, para
  modelo novo, o da origem do pedido, RN-041; editável; **campo vazio não
  vira zero**, zero só explícito) e a CONFERÊNCIA (diferença, como acertar,
  frete combinado). **O pedido original não é tocado**: valor vendido,
  status, data da venda, comissão, nota e o carimbo da Separação são
  história (reescrevê-los mexeria em mês já fechado e lançado, RN-038) — por
  isso o Financeiro e o Dashboard **não mudam** com a troca (ADR-018). **Só
  pedido cuja peça JÁ SAIU troca**: enviado, entregue ou a prazo entregue
  (RN-069) — derivado das listas. Pago/em produção/separação é recusado
  (409) com o caminho: *se a peça já foi com a cliente, marque o pedido como
  entregue e registre; se não foi, edite os itens* — ali a Separação lê os
  itens e o Inventário o livro, e uma troca deixava os dois contando a peça
  de jeitos opostos (achado da revisão). **Depois da primeira troca os
  itens TRAVAM** (a porta de edição recusa, a ficha diz): os itens são o
  retrato da venda e o que a cliente tem é **itens ± trocas** — "ajustar
  os itens para refletir a troca" devolveria à arara a peça devolvida e
  baixaria de novo a levada; o reconciliador da edição ainda conhece as
  trocas (`ajusteDasTrocasPorVariacao`) como segunda tranca. **O estoque
  anda pelo livro** (RN-003): peça boa que volta é ENTRADA (sobe), peça que
  sai é SAÍDA **mesmo sem estoque** (pedido do dono, 13/10/2026: *"o
  sistema deve permitir mesmo que esteja zerado; ele pode ficar negativo e
  informar o vendedor"* — a cliente já está com a peça na mão, e recusar
  só deixava a troca sem registro): as peças que saem são TRAVADAS e descem
  SEM condição, o número fica negativo (= o que a loja deve repor) e
  **quem registra é AVISADA três vezes** — a célula da grade
  diz "N sem estoque" (`permiteNegativo`, sem a janela "estou ciente":
  não é extra, não há pedido para produzir), a conferência diz "zerada no
  estoque — vai ficar −1" antes de registrar (contando a peça boa da mesma
  cor × tamanho que volta — a grade também a soma), e depois o servidor
  devolve as peças que ESTA troca deixou abaixo de zero ou mais fundas
  (`semEstoque`, conta exata sob a trava: antes + o que volta boa − o que
  sai — `pecasQueFicaramNegativas`; a peça que já devia e a troca não
  mexeu não entra), que viram faixa no bloco Trocas e nota própria na
  história do pedido (`textoDaSaidaSemEstoque`). **A peça do Jueri é a
  exceção** e é recusada com frase: lá o estoque não desce de zero e a
  sincronização grava o número de lá por cima (RN-050) — o −1 viraria 0 e
  o cancelamento seguinte devolveria uma peça que nunca existiu, aqui E lá
  (a razão da RN-076 deixá-la de fora). No Inventário a peça comum
  negativa conta como **zerada** (a sob encomenda devendo é "A
  produzir") e a linha de ajuste diz que ela saiu sem estoque; e
  **defeito é ENTRADA + SAÍDA solta ("baixa por defeito")**: o estoque não
  muda, mas o livro conta que voltou e foi baixada. Os movimentos levam o
  `orderId` quando o estoque do pedido é daqui — assim o pedido passa a
  "segurar" o que a cliente tem AGORA: **cancelar depois da troca devolve a
  peça nova, não a antiga**, e **restaurar o cancelado reserva o pacote
  efetivo** (`pacoteEfetivo`, itens ± trocas — reservar os itens originais
  traria peças que já voltaram todas); a venda da loja online (Nuvemshop)
  move o estoque **sem** o pedido (o livro daqui nunca teve a saída dela) e
  a tela diz que o pedido lá não muda. O espelho para a Nuvemshop/Jueri sai
  pela fila de sempre (RN-053), depois do commit. **O teto do que volta é
  por VARIAÇÃO + preço pago** (ou pelo retrato nome|cor|tamanho|preço da
  peça apagada, `chaveDaPeca`), comprado − já devolvido: a porta de edição
  recria as linhas com ids novos, então um teto preso ao id da linha zerava
  a cada edição; e a mesma peça a dois preços (uma promocional) são dois
  grupos — devolver cada uma vale o que ela custou. **A conta**: o que
  volta vale o preço PAGO no pedido (a cliente não paga mais caro pela peça
  que já era dela), o que sai vale o combinado; a diferença decide o que se
  pode fazer — zero: nada; cliente devendo: **cobrar** (ela paga por fora;
  alguém confirma "recebi", com nome e data, em qualquer status do pedido,
  uma vez só mesmo com duas abas); loja devendo: **crédito** (linha
  positiva no livro `CustomerCredit`; o saldo é a SOMA, nunca digitado, e
  aparece na ficha da cliente e no bloco de trocas) ou **devolução** (alguém
  confirma "devolvi"). Sem diferença e crédito nascem acertados. O servidor
  recusa resolução que não combina com o sinal. **O dinheiro da troca
  acompanha o pedido**: cancelar **estorna** o crédito que as trocas dele
  deram (a venda inteira está sendo devolvida — manter os R$ 12 pagaria a
  mesma diferença duas vezes) e DIZ na história o que ainda falta acertar
  E o que já andou por fora (os R$ 16 recebidos na troca 2 têm que voltar
  com a devolução do pedido; os R$ 10 já devolvidos se abatem); restaurar
  **repõe** o crédito; apagar estorna de vez (a troca cai em cascata, o
  livro fica). Tudo pelo saldo daquela troca no livro
  (`TROCA`/`TROCA_ESTORNO`/`TROCA_REPOSICAO`), idempotente. **Unificar
  contatos leva troca e crédito** para a ficha que sobrevive. **Trava por
  pedido** (`pg_advisory_xact_lock`) na troca, na edição de itens, na
  mudança de status e na exclusão — a mesma fila, senão a edição lia o
  livro antes de a troca commitar. **Réguas**: devolução sem peça nova **não
  é troca** (é cancelamento ou edição de itens); peça inativa não sai;
  suporte não registra (mexe em dinheiro, régua dos valores do pedido); o
  único (pedido, número) é a segunda tranca contra a troca em dobro. **Fica
  registrado**: a história do pedido ganha a frase inteira (quem, o que
  voltou — defeito marcado —, o que levou, o dinheiro, motivo e frete), a
  lista de Pedidos mostra o selo **"N trocas"**, e o bloco "Trocas" na
  ficha lista cada uma com o botão de confirmar o acerto. Provado pelas
  rotas de verdade contra o Postgres local (`scripts/e2e-troca.ts`, 13
  cenários: status, papel, estoque, defeito, peça que sai sem estoque
  (fica −1, avisa, cancelar devolve a 0; a do Jueri é recusada), itens travados, teto, crédito,
  acerto, cancelar/restaurar/apagar, loja online). **Limites ditos**: a
  Nuvemshop recebe zero da peça negativa (RN-076); restaurar o pedido cancelado depois de
  uma troca sem estoque reserva o pacote efetivo e a peça que falta volta
  como extra, com a janela de sempre (RN-075); o dinheiro da troca (crédito usado num pedido novo e o
  acerto no Financeiro) é a RN-074. **O relatório** é a aba **Trocas** do
  Estoque (`lib/troca/relatorio.ts`, gerência — mostra dinheiro, a régua do
  Painel): no período escolhido (7, 30, 90 dias ou 1 ano, pela data da
  TROCA), quantas trocas, peças que voltaram (com defeito) e que saíram, o
  dinheiro separado pelo que andou (recebido, devolvido, a confirmar,
  crédito dado — a troca de pedido depois CANCELADO conta nas peças mas
  fica fora do dinheiro, que foi desfeito com a venda, e a tela diz),
  **por que trocaram** (pelo chip do motivo — o motivo é gravado "Chip —
  detalhe", e frase solta conta como "Outro", nunca uma linha por frase;
  as porcentagens fecham 100) e **as peças que mais voltam** (produto ×
  cor × tamanho, pela régua de agrupar nome da curva ABC, pelo retrato da
  troca — peça apagada não some da conta; mostra as 30 primeiras e diz de
  quantas), mais as últimas trocas com link para o pedido; acima de 2.000
  trocas no período a tela diz que cortou. **Limite dito**: a aba vive no
  módulo Estoque (decisão do dono) — loja sem o módulo registra trocas e
  vê cada uma na ficha do pedido, mas não o relatório.
  **RN-074 · O CRÉDITO DA TROCA VIRA DESCONTO NO PEDIDO NOVO, E O DINHEIRO
  QUE ANDOU NA TROCA ENTRA NO FINANCEIRO** (`lib/troca/credito-no-pedido.ts`
  + `lib/troca/credito.ts` + `registrarAcertoDaTrocaNoFinanceiro` em
  `lib/financeiro/porta-vendas.ts`, 08/10/2026): a segunda parte da troca,
  combinada com o dono. **Usar o crédito**: na ficha de um pedido AINDA NÃO
  PAGO NEM ENTREGUE (orçamento ou aguardando pagamento — a venda a prazo
  entregue já contou comissão na entrega, RN-069, e abater depois mexeria
  num mês fechado) a faixa verde diz quanto a
  cliente tem e oferece **"Usar neste pedido"** (e "Tirar o crédito"). Entra
  tudo o que ela tem, até o valor do pedido antes do crédito — **o frete
  não é coberto** (não é venda, RN-002). O crédito é **DESCONTO, não
  pagamento** (`Order.creditoTroca`, 5º termo de `computeOrderTotals`,
  depois do desconto e do acréscimo): os R$ 12 já tinham voltado para a
  cliente na troca — contados como pagamento, a loja faturaria e pagaria
  comissão sobre dinheiro que não entrou; como desconto, a soma das duas
  vendas bate com o que entrou no caixa. **Nunca no pedido pago** (o
  dinheiro já entrou) **nem na venda da loja online** (o valor é o da
  Nuvemshop). O livro da cliente (`CustomerCredit`) ganha a linha negativa
  presa ao pedido, e o pedido, a linha "Crédito de troca −R$ 12" na ficha,
  no PDF e no CSV; a cobrança pendente acompanha o total novo (o Pix/link
  antigo expira, a régua da edição de valores) e o lançamento do Financeiro
  acompanha pela porta única (RN-033). **O crédito nunca some**: editar os
  itens ou o desconto até o pedido ficar menor que o crédito devolve a
  sobra ao livro; **cancelar** devolve tudo (e o pedido restaurado NÃO
  reaplica — toca "Usar" de novo); **apagar** devolve tudo. O crédito é
  **relido sob a trava do pedido** em toda porta que o toca
  (`aplicarCreditoAtual` na edição de itens e de valores, o cancelamento e a
  exclusão): com o número lido antes da transação, um "Usar" no meio era
  sobrescrito e a cliente perdia o crédito (achado da revisão). **Trocar a
  cliente do pedido com crédito abatido é recusado** ("tire o crédito
  antes") — senão o crédito de uma voltava para a ficha da outra. E o
  estorno do crédito de uma troca cujo pedido é cancelado tem **teto no
  saldo de hoje**: se o crédito já foi usado em outro pedido, a ficha não
  fica negativa — o que já tinha sido usado é DITO na história ("abater da
  devolução do pedido") e ANOTADO na troca (`creditoAbatidoNaDevolucao`),
  senão o crédito "vigente" dela reaparecia e um cancelamento seguinte
  estornaria de novo. No cancelamento e na exclusão, **primeiro volta o
  crédito que o pedido USOU, depois sai o que as trocas DELE deram** — na
  ordem inversa, o pedido que usou o crédito da própria troca deixava a
  cliente com ele. **Fila por pedido E por cliente** (as duas
  `pg_advisory_xact_lock`, sempre nesta ordem): duas abas usando o mesmo
  crédito em dois pedidos não o gastam duas vezes. **O dinheiro que ANDOU** na troca entra
  no Financeiro **quando alguém confirma** ("recebi" / "devolvi") e já
  baixado na conta padrão: a diferença que a cliente pagou é **RECEITA na
  categoria de venda do pedido** (é venda a mais) e a que a loja devolveu é
  **DESPESA em "04.06 Devoluções e trocas"** (é venda que voltou; a
  semeadura completa a categoria nas lojas antigas, e a porta só usa a
  categoria DO SISTEMA — a loja que já tinha uma categoria dela no 04.06
  não vê devolução caindo em "Brindes"; sem a nossa, nasce sem categoria).
  1 troca = 1 lançamento (o único do banco), sem módulo a porta sai calada,
  e o crédito não passa por ali — dinheiro nenhum andou. **Sem conta
  padrão** o lançamento nasce em aberto dizendo por quê, **fica fora da
  Inadimplência** (cobrar pelo WhatsApp um dinheiro que a loja confirmou
  ter recebido seria o pior erro possível) e é **repescado** quando a conta
  padrão for escolhida (a mesma varredura de carona das vendas, só parcela
  que nunca teve baixa). A cobrança Pix/link do valor antigo expira e a
  ficha diz para gerar outra; o funil acompanha o valor vendido; e o
  seguro do frete com NF-e passou a ser o valor da NOTA (`netTotal`, com
  acréscimo e crédito), não "peças − desconto". **Limites ditos**: o desconto do crédito
  reduz a comissão de quem vendeu o pedido NOVO (a diferença nasceu no
  pedido da troca); o Dashboard não vê a diferença cobrada na troca (ele
  soma pedidos, RN-001) — o Financeiro vê. Provado pelas rotas de verdade
  contra o Postgres local (`scripts/e2e-credito-troca.ts`).
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
  **Celular sem o 9 é recusado no formulário** (`celularSemONove` em
  `lib/format.ts`, 29/09/2026, relato do dono: pedido com "(35) 9971-3320",
  a Central tentou responder duas vezes e o WhatsApp disse que o número não
  existe): oito números depois do DDD começando com 6–9 não existem desde
  2016 (fixo começa com 2–5), e o formulário aceitava porque dez dígitos é o
  formato do fixo. O catálogo e o "Novo contato" da Central param e sugerem o
  número com o 9; o servidor segue aceitando (RN-010). E quando o WhatsApp
  responde que o número **não tem conta** (`"exists": false`), a bolha diz
  isso em português, com a sugestão do 9 quando cabe
  (`lib/comm/numero-sem-whatsapp.ts`) — antes mostrava o JSON cru do
  servidor e duas vendedoras reenviaram achando que era falha de envio.
  **RN-096 · NÚMERO DE FORA DO BRASIL NÃO GANHA 55 — E O NÚMERO DO WHATSAPP
  JÁ VEM COM O DDI** (`lib/telefone.ts`, puro; `normalizePhone`,
  `phoneMatchVariants` e `formatPhone` passam por ele, 26/10/2026): relato do
  dono com o print da Toque Leve — a cliente Rafaela aparecia como
  "(17) 81408-6755", numa conversa "na fila" que ninguém conseguia responder
  (o WhatsApp dizia que o número não existe). Não existe mesmo: o que chegou
  foi `17814086755`, **+1 781 408-6755**, um número dos EUA; o sistema via
  onze dígitos, concluía "brasileiro sem DDI" e colava o 55 — nascia o
  cadastro `5517814086755`, a resposta da loja ia para o nada e a cliente que
  escrevia do exterior ficava sem resposta. Duas réguas: (1) **o número que
  vem do WhatsApp já tem o DDI** — os dois webhooks (Evolution e API
  oficial) e a importação de histórico o passam adiante com o `+` na frente
  (`declaraDdi`; o "00" de discar para fora também declara), e aí nada se
  adivinha;
  (2) **o digitado só ganha 55 se tiver CARA de brasileiro**
  (`pareceNumeroBrasileiroSemDdi`: DDD que existe e, com onze dígitos, o 9
  na terceira posição; com dez, fixo ou o celular antigo sem o 9, que o
  cadastro tolera). Na tela, número de fora sai como "+1 781 408-6755"
  (`formatarInternacional`, DDI de 1, 2 ou 3 dígitos pela lista da UIT) e
  nunca mais como um DDD; a sugestão "faltou o 9" só vale para DDD que
  existe. **O cadastro antigo com o 55 colado se cura sozinho**: as variantes
  de busca incluem a forma antiga (`55` + o número — também para o número
  de fora com cara de brasileiro, o +51 9… do Peru, quando o DDI veio dito),
  o cadastro com o número EXATO vence o antigo só quando o antigo é o do 55
  colado (para o brasileiro com dois cadastros legados, com e sem o 9, segue
  valendo o mais antigo — senão cada canal caía num cadastro), e a primeira
  mensagem da cliente corrige o número no intake
  (`guardadoComCinquentaECincoPorEngano`), com a linha do tempo dizendo —
  **só com o número VERIFICADO pelo webhook** (`telefoneVerificado`, que só
  os dois webhooks marcam): o `+` digitado num formulário não é certeza,
  "+11 99876-1001" é um brasileiro com o DDI esquecido e a cura tiraria o 55
  de um cadastro certo; a migração `20261026120000` tira o 55 de todo "55 +
  onze dígitos" sem o 9 na terceira posição ou com DDD que não existe (a
  mesma lista da lib — nunca é número brasileiro), só onde não há colisão. **Limite dito**: número de fora DIGITADO sem o `+` e com a cara
  exata de um celular brasileiro (um +1 de área 29x, o +51 9… do Peru) segue
  lido como brasileiro — vindo do WhatsApp nunca há dúvida, e é de lá que
  vem a cliente de fora. Provado contra o Postgres local
  (`scripts/e2e-pedido-de-outro-numero.ts`, cenários 1–2).
  **RN-097 · O MESMO PEDIDO DO CATÁLOGO CHEGANDO DE OUTRO WHATSAPP: O
  WHATSAPP É O NÚMERO VERIFICADO** (`lib/comm/pedido-de-outro-numero.ts`,
  chamado pelo intake e pela porta do pedido, 26/10/2026, ADR-023): relato do
  dono — *"quando a pessoa manda o pedido e coloca um número diferente do
  dela, o sistema abre outra conversa e duplica"* e *"o pedido chega duas
  vezes no WhatsApp (não duplica na aba Pedidos, mas duplica nas
  mensagens)"*. É um defeito só: a cliente preenche o pedido com o telefone
  Y (o catálogo cria o cadastro Y, a bolha do pedido, abre o wa.me) e a
  mensagem de verdade sai do WhatsApp do APARELHO, o número X — o webhook
  cria outro cadastro, outra conversa na fila e outra bolha com o mesmo
  texto (a RN-043 só junta a MESMA cliente; a RN-021 só vale pelo link
  pessoal). Régua, que estende a RN-021: **o WhatsApp por onde a mensagem do
  pedido chegou é o número verificado** (foi o aparelho que montou o pedido
  que a mandou); o digitado é palpite e fica anotado. Como juntar cadastro
  sozinho é o que a RN-020 proíbe, a prova exigida é FORTE, as três: o
  texto é o do pedido, idêntico, dentro da meia hora da bolha; o cadastro do
  digitado **NASCEU DESTE PEDIDO** (`nasceuDoPedido`: origem catálogo,
  criado na janela, nunca recebeu mensagem pelo WhatsApp — se o número
  digitado é de uma cliente de verdade, nada é tocado e vale o aviso
  "parece a mesma pessoa" de sempre); e, para FUNDIR, o pedido já existe (a
  porta cria o pedido DEPOIS do intake, e apagar o cadastro no meio
  quebraria a criação — RN-010). Três saídas (`decidirAdocao`, pura): X
  ainda não é cliente → o cadastro nascido do pedido **LEVA o número X**
  (nada se apaga; pedido, conversa e bolha ficam, e a bolha é reaproveitada
  pelo caminho de sempre); X já é cliente e o pedido existe → o cadastro do
  digitado é **FUNDIDO no de X** pelo caminho da unificação de contatos
  (`repointCustomer`: pedido, conversa, histórico e bolha vão para X, as
  conversas abertas viram uma); o webhook chegou PRIMEIRO → a porta do
  catálogo **adota X antes de criar qualquer coisa**
  (`telefoneDoWhatsAppDoPedido` → `telefoneDoPedido` com `doWhatsApp`, que
  vence até o link pessoal). A corrida (o webhook vê a bolha mas o pedido
  ainda não existe) é fechada pela própria porta do pedido, que no FIM, com
  o pedido criado, procura a mensagem de verdade e funde
  (`juntarDepoisDoPedido`, tirando a bolha sem id — a mensagem de verdade
  fica); os dois lados tomam a MESMA trava, pelo texto limpo do pedido
  (`pg_advisory_xact_lock(hashtext(...))`). Tudo fica dito: nota 📱 na
  conversa e linha do tempo da cliente com os dois números, e a observação
  do pedido diz que o digitado era outro. Falha aqui nunca derruba a
  mensagem nem o pedido (vai para a Saúde sem alarme, régua da RN-066).
  **Limite dito**: quando o número digitado é de uma cliente de verdade da
  loja (a sócia, a irmã), continuam dois cadastros e a bolha aparece nas
  duas conversas — para o sistema são duas pessoas, e a gerência unifica
  pelo aviso. Provado pelas rotas de verdade contra o Postgres local
  (`scripts/e2e-pedido-de-outro-numero.ts`, cenários 3–7: X desconhecido, X
  já cliente, webhook primeiro, cliente de verdade intocada, e a corrida
  fechada no fim da rota, idempotente).
- **RN-009 · Catálogo público**: preço/total SEMPRE recalculado no servidor; links
  rastreados `?ref=` (vendedora) e `?c=` (cliente) alimentam a atribuição.
- **RN-010 · O pedido do catálogo NÃO PODE SE PERDER** (`lib/catalogo/envio-pedido.ts`):
  o aparelho sorteia um protocolo (`Order.clientRef`, único por loja),
  guarda o pedido antes de mandar, INSISTE se falhar e reenvia na próxima
  visita; a rota é idempotente (devolve o pedido existente, e a corrida cai
  no índice único → P2002 tratado). A cliente vê o recibo do registro na
  tela. Já causou incidente real: `.catch(() => {})` engolia a falha, a
  mensagem chegava no WhatsApp da vendedora e o pedido não existia.
  **Recusa do servidor deixa RASTRO** (`lib/catalogo/recusa-do-pedido.ts`,
  09/10/2026, relato da Sutilli Semijoias: *"a mensagem chega no WhatsApp,
  mas o pedido não entra na aba Pedidos — e acontece sempre"*): a rota recusa
  em quatro situações (dados inválidos, loja/peça que não existe, link de
  tabela vencido, mínimo do atacado) e a recusa só aparecia no celular da
  CLIENTE — a loja ficava sem pedido e sem pista. Agora toda recusa decidida
  pela rota grava uma linha na Central de Comunicação da loja
  (`catalogo.pedido-recusado`: quem pediu, quantas linhas, a frase dita à
  cliente, o detalhe — QUAL peça/variação ou QUAL campo, em português — e o
  protocolo) e uma no painel de Saúde com **fonte própria**
  (`catalogo.recusa`): **fora da lista e da conta de erros**, em bloco
  próprio com as últimas, pela régua da "versão velha" da RN-066 — recusa é
  resposta decidida, e porta pública recebe lixo de robô; contá-la como erro
  enterraria os erros de verdade. A trava de ritmo (`catalogo.flood`) passa
  pelo mesmo caminho. Quatro réguas da revisão: o registro vai no `after()`
  (a vitrine espera a resposta para abrir o WhatsApp); tem **teto por IP +
  loja** (`catrec:`, 10 por 15 min, RN-044 — por loja, senão a operadora de
  um bairro inteiro calava o rastro da loja ao lado; fechou o teto, a
  resposta é a mesma e só o registro para); o que vem do corpo é CORTADO
  (nome de 3 KB não engole motivo e protocolo); e **o reenvio de pedido que
  JÁ ENTROU responde "já registrado" ANTES de qualquer recusa** (o link de
  tabela que venceu entre o envio e o reenvio da fila virava recusa FALSA no
  rastro, mandando a lojista colar de novo um pedido que existe). Erro
  inesperado (500) já ia para a Saúde pelo `onRequestError`. O que continua
  sem rastro no servidor, por definição, é o aparelho que nunca conseguiu
  chegar nele (sem internet) — esse fica na fila do aparelho (acima).
  Provado contra o Postgres local (`scripts/e2e-pedido-catalogo-sem-cores.ts`).
  **RN-078 · PEÇA SEM COR SE CHAMA "Único"** (`lib/cor-da-peca.ts`,
  09/10/2026): a causa provável do relato da Sutilli, achada lendo o código —
  a sincronização da Jueri gravava a variação de peça SEM COR com a cor
  **VAZIA** (`""`), a vitrine mandava `color: ""` e a porta do pedido recusava
  o pedido INTEIRO como "dados inválidos" (400): a cliente via o erro, a
  mensagem ia para o WhatsApp e o pedido não existia. A mesma cor vazia
  impedia salvar a ficha da peça. "Único" é o nome que a casa já usava para
  "não tem cor" (Nuvemshop sem atributo de cor, importação de catálogo), então:
  a sync da Jueri passa a gravar "Único" (`corOuUnica`) e **CURA** a peça
  que ainda estiver vazia a cada rodada (o código velho segue no ar durante
  o build, DEPOIS de a migração rodar, e podia criar uma vazia nesse
  intervalo); a migração `20261009150000` renomeia as que já existem — "vazia"
  inclui tab e o espaço invisível, a mesma régua do trim —, **uma por produto
  × tamanho e só onde não há "Único"**, porque migração que colide no único
  de produto × cor × tamanho falha e PARA todos os deploys (P3009); e a porta
  do pedido **aceita cor vazia** e acha a variação por `acharVariacao`:
  **o EXATO primeiro** (com "" e "Único" na mesma peça, a ordem de leitura
  não escolhe a errada; "Preto" e "Preto " seguem cores diferentes) e só a
  cor vazia faz a **ponte para "Único"** — o pedido que ficou na fila do
  aparelho com `color: ""` (RN-010) casa com a peça renomeada em vez de ser
  recusado. A sacola guardada no aparelho com a chave antiga (`produto|`)
  volta como `produto|Único` (`limitarSacola`). O rastro da recusa mostra a
  cor que CHEGOU ("(cor vazia)"), não a traduzida. A linha do pedido grava a
  cor do cadastro ("Único"). Provado contra o Postgres local (mesmo script,
  cenários 6 e 7: o código antigo responde 400, o novo 201, e a migração
  atravessa as duas colisões) e no `e2e-jueri-sync.ts` (2d: nasce "Único" e
  a vazia se cura). **Limite**: a peça que a migração deixou vazia por
  colisão (só existe se alguém criou "Único" à mão no mesmo produto e
  tamanho) segue sem salvar a ficha até alguém apagar uma das duas.
  **RN-011** · Todo pedido do catálogo AVISA na hora (`notifyNovoPedido`): com vendedora
  no link, só ela; sem vendedora, gerência/admin (nunca uma vendedora
  qualquer — a separação por link vale também para o aviso).
  **RN-067 · A QUANTIDADE NO CATÁLOGO PÚBLICO PARA NO ESTOQUE DISPONÍVEL**
  (`lib/catalogo/teto-do-estoque.ts`, 25/09/2026): relato do dono com o
  print da Entre Linhas — *"esse produto tem apenas um em estoque, porém a
  cliente consegue adicionar o quanto quiser no carrinho e ainda enviar o
  pedido"*. O servidor já fazia a parte dele (RN-003: reservou a única peça
  e anotou a falta no pedido e no histórico; RN-010: pedido do catálogo não
  se recusa), mas a vitrine só recebia **"tem / não tem"** por tamanho
  (`available`), e o `+` aceitava qualquer número enquanto houvesse uma
  peça: a cliente mandava 8 no WhatsApp achando que vinham 8 e a loja
  descobria a diferença na hora de cobrar. Agora a vitrine recebe **QUANTAS
  há** de cada cor × tamanho (`disponivel` — o `stock` da peça, que já é o
  disponível descontada a reserva, RN-003/RN-050, nunca negativo e no teto
  que a rota aceita numa linha) e a quantidade **PARA nesse teto**, dizendo
  **"só N disponíveis"** — a mesma régua da grade de montar pedido (RN-062,
  "máx N"). A frase aparece quando a quantidade encosta no teto e, para peça
  quase acabando (até 3), desde o começo — "só 1 disponível" antes do
  primeiro toque. **Três caminhos, uma régua** (`limitarQuantidade`/
  `limitarSacola`): o `+` da folha da peça, a sacola que volta do aparelho
  (localStorage) e a sacola abandonada que volta pelo link passam pelo
  estoque de HOJE — peça que zerou sai, quantidade acima do disponível
  desce até ele; a grade abre com o que já está na sacola JÁ no teto. Vale
  no catálogo geral, no link de tabela e no catálogo de campanha (os dois
  produtores mandam o número, e o teste confere). **O servidor continua
  sendo a segunda tranca**: estoque que cai entre montar a sacola e enviar
  (outra cliente comprou, a loja online vendeu) segue reservando o que há e
  gritando a falta no pedido — o teto aqui é o que impede a cliente de pedir
  o que a vitrine já sabia que não existe. Limite aceito e dito: a
  quantidade exata viaja para o navegador (é o que permite o teto), como em
  qualquer loja online.
  **RN-068 · COMO CHAMAR A UNIDADE NO CATÁLOGO PÚBLICO**
  (`lib/catalogo/unidade.ts`, 02/10/2026): pedido do dono com o print da
  cliente — *"quer trocar esse 'peça' por 'conjunto'"*. O catálogo escrevia
  "R$ 86,90 / peça" para tudo, e quem vende conjunto, kit ou par não tinha
  onde mudar. Três decisões: (1) **é um PAR, singular e plural** — o "/ peça"
  do card é só o lugar mais visível; o catálogo também escreve "faltam 3
  peças", "adicionar 2 peças ao pedido" e a **mensagem do pedido** ("2 peças ·
  R$ 173,80"), e trocar só o singular deixaria a cliente lendo "3 conjunto";
  um só preenchido é RECUSADO nas três portas. (2) **A escada é peça >
  categoria > loja**, a mesma do mínimo (RN-051) e do NCM (RN-055), pelo mesmo
  motivo: a loja que vende só conjunto configura uma vez (Configurações →
  Catálogo); a que tem a categoria "Conjuntos" configura lá (Produtos →
  Categorias, ícone 📦, JSON `categoryUnits` no padrão das descrições — renomear
  leva junto, apagar não deixa órfã); o kit solto dentro de "Conjuntos" se
  corrige na ficha dele. Resolvida **no servidor**, nos DOIS produtores da
  vitrine (`montar-catalogo` e o catálogo de campanha), e a vitrine só recebe
  a palavra pronta. (3) **A fronteira**: texto sobre UM produto (preço do
  card, ficha, atacado, "adicionar N", a linha dele na mensagem, o mínimo por
  modelo do atacado) usa a palavra **dele**; texto sobre o **pedido inteiro**
  (mínimo da sacola, que mistura categorias) usa a palavra da **loja**; e as
  **telas internas não mudam** — Separação, Estoque, relatórios: ali um pedido
  mistura tudo e "4 de 4 peças bipadas" precisa ser uma palavra só. Só letra
  (com acento), espaço e hífen, até 20 — a palavra vai para a vitrine pública
  e para o WhatsApp. **Loja que não configurar nada não muda em NADA.** O
  leitor do "Colar pedido do WhatsApp" (RN-012) passou a ler o **Total** pelo
  NÚMERO depois de "Total:", não pela palavra "peça" (era assim, e a mensagem
  de uma loja de conjuntos perderia a conferência do total); os itens já eram
  lidos pela posição.
  **RN-070 · A LOGO DA LOJA NA VITRINE PÚBLICA VAI POR ENDEREÇO, NUNCA
  DENTRO DA PÁGINA** (`lib/catalogo/logo-da-loja.ts` + rota
  `app/api/img/logo/[slug]`, 07/10/2026): relato do dono com o print do
  iPhone — a cliente abria o link do catálogo pelo WhatsApp e via só a **tela
  preta**, com a barrinha de carregamento parada no começo. A logo mora no
  banco como data-URL (dívida nº 1) e ia embutida na página **três vezes**
  (cabeçalho, rodapé e os dados do React); a primeira cópia fica no topo do
  `<body>`, e o navegador precisa baixar o bloco inteiro antes de desenhar
  qualquer coisa. Medido com uma logo pesada: a página foi de 1,2 MB para
  12,4 MB, e num 4G fraco a primeira pintura saiu de 1,7 s para **18 s** — o
  "não abre" de quem está com sinal ruim, enquanto quem está no Wi-Fi não
  percebe nada. Depois do conserto, a mesma loja: 1,2 MB e 1,7 s. As fotos dos
  produtos já tinham aprendido isso (`/api/img/<id>`, o catálogo da Entre
  Linhas chegava a 19 MB); a logo ficou para trás. Agora os dois produtores da
  vitrine (o catálogo normal/tabela e o de campanha) mandam só
  `enderecoDaLogo`: `/api/img/logo/<loja>?v=<impressão digital do
  conteúdo>` — trocar a logo muda o endereço na hora. Com a versão certa o
  cache é forte (um ano no navegador, **um dia na CDN**, para a loja suspensa
  sair da borda no dia seguinte); sem versão ou com uma velha, 1 minuto. A
  rota é **pública e só de leitura** (`/api/img` já é público no porteiro),
  responde 404 para loja suspensa ou inexistente (régua do catálogo) e **só
  entrega imagem de verdade**: PNG, JPEG, WebP ou GIF conferidos pelo
  CONTEÚDO (`lerImagem`, a mesma régua do `isRealImage`), nunca pelo rótulo —
  a logo é gravada por uma rota que aceita qualquer texto, e um SVG com
  script servido no endereço do app rodaria com a sessão de quem abrisse —,
  com `nosniff`; valor torto vira 415, nunca 500. Logo acima de 300 KB sai a
  800 px no lado maior, com a orientação da câmera aplicada: JPEG e WebP no
  formato deles, PNG e GIF como PNG (a transparência do "remover fundo"
  continua; o GIF perde a animação) — e se não sair menor, vale o original.
  **Logo de outro tipo (SVG que veio por importação, BMP) segue EMBUTIDA**,
  como sempre foi: mandá-la para a rota trocaria uma logo que funcionava por
  imagem quebrada, e SVG de logo costuma ser pequeno. Logo gravada como link
  externo passa como está. **Limites ditos**: a página ainda LÊ a logo do
  banco a cada visita (já lia antes — o que saiu foi o peso na página da
  cliente); a bio pública (`/bio/[slug]`) ainda embute avatar, capa e
  imagens dos links do mesmo jeito — é entrega própria; e o ícone da aba do
  catálogo (`icon.tsx`) continua lendo a data-URL, mas é outro pedido, que
  não segura a página.
  **RN-071 · FOTOS PARA A CLIENTE: LINK DE 7 DIAS, GALERIA SEM PREÇO,
  DOWNLOAD FOTO A FOTO** (`lib/fotos/link.ts`, página
  `/catalogo/<loja>/fotos/<código>` — curta em `catalago.net/<loja>/fotos/…`
  —, botão 📸 na Central, 07/10/2026): pedido do dono — *"a cliente sempre
  fica me pedindo foto das blusas; pensei num drive onde todas as fotos do
  catálogo ficam, e dentro do WhatsApp eu mando o link"*. Decidido com ele:
  (1) **não é drive, é FILTRO**: nenhuma foto é copiada — o link guarda só
  código, categorias, vendedora e dois contadores, e a galeria mostra o
  acervo de **hoje** (peça inativa ou zerada some sozinha; nada engorda o
  banco além de uma linha por link); (2) **só a foto**: sem preço (a
  revendedora reposta com o preço dela) e sem marca d'água (ela usa nas
  redes sociais dela); (3) **sem ZIP** — "muita gente tem dificuldade de
  abrir": cada foto tem o seu **Salvar** (`/api/img/<id>?baixar=1&nome=…`
  entrega a MESMA foto como arquivo com nome legível, "Regata Alça -
  Preto.jpg", **com a extensão do tipo real** — png não vira .jpg — e o
  nome simples do cabeçalho em ASCII: emoji ou travessão no nome da peça
  derrubava o download inteiro com 500, achado da revisão; o nome completo
  vai no `filename*`), e **"Salvar todas" tem dois caminhos** porque os
  aparelhos são diferentes: Android/computador baixa **uma a uma em
  sequência**; **iPhone** vai pela folha de compartilhar do aparelho
  (`navigator.share` com arquivos → "Salvar imagens" na galeria de fotos,
  teto de 40 por vez) — o Safari só honra o download disparado pelo TOQUE e
  a tela anunciaria 20/20 com uma foto salva; se o aparelho não deixar, a
  tela DIZ para salvar uma a uma; (4) **link aberto, válido por 7 dias**:
  quem tem o link entra — depois de baixar a foto já está no celular dela,
  senha não protegeria nada; venceu, a página explica e aponta o WhatsApp da
  loja (`waLink`, a régua da bio — nunca 404 seco), e a cliente pede outro.
  A vendedora escolhe as **categorias** (ou todas) e se entram **só peças
  com estoque** (padrão: sim — a cliente não posta o que a loja não tem), e
  isso vale **por COR**: a regata com Preto em estoque e Branco zerado
  mostra a foto do Preto e esconde a do Branco (foto sem cor marcada é da
  peça e fica; peça que ficou sem foto some). O link carrega a
  **vendedora** (quem gera; suporte gera sem dona) e a galeria tem o botão
  **"Ver catálogo"** com o `?ref=` dela (`trackedLinkParts`, a régua do
  link rastreado) — a cliente que gostou da foto e pede cai na comissão de
  quem mandou (RN-005). Quem envia é sempre a vendedora: a mensagem pronta
  volta para o campo (RN-017; cliente com crachá provisório é saudada sem
  nome, nunca "Oi, Contato!"). **Aberturas** são somadas no `after()` (a
  chamada solta era congelada pela Vercel, RN-033/RN-053) e **downloads**
  pela porta pública mínima `/api/catalogo/fotos/evento` (só incrementa um
  contador de link que existe e ainda vale, **com ritmo por IP** — RN-044,
  chave `fotosev:`). Limite aceito: a galeria lê as fotos do banco
  (dívida nº 1) — a migração para armazenamento de arquivos ganha mais um
  motivo, pelos downloads.
  **RN-094 · O CATÁLOGO EM PDF: UM ARQUIVO SÓ, DA MESMA FONTE DA VITRINE, E
  É UMA FOTOGRAFIA DO MOMENTO** (`lib/catalogo/pdf.ts` + `pdf-layout.ts` +
  `foto-do-pdf.ts`, sobre `lib/catalogo/acervo.ts` e `secoes.ts`, rota
  `/api/catalogo/pdf`, botão em Configurações → Catálogo, 23/10/2026,
  ADR-021): relato recorrente do dono — *"alguns clientes estão reclamando
  que o catálogo não tá abrindo… converter o catálogo que a gente tem online
  em PDF, como se fosse a página mesmo do website, só que estático"*.
  **O PDF não é mais leve que a página** (medido: 243 peças = 22 páginas =
  2,3 MB; a página está em ~1,2 MB desde a RN-070) — e não é por isso que
  ele existe: é **UM arquivo**, que baixa de uma vez, fica no aparelho e abre
  **sem internet, sem navegador e sem JavaScript**, e a cliente repassa para
  a amiga. A vitrine são dezenas de idas à internet (uma por foto) e basta
  uma falhar para dar tela branca. É paliativo assumido: não substitui achar
  a causa do "não abre". **(1) Sai da MESMA fonte da vitrine**, e por isso a
  vitrine foi refatorada primeiro: a leitura do acervo virou
  `acervoDaVitrine` (quais peças, qual preço) e a régua "um card por COR,
  nesta ordem" virou `secoesDaVitrine`/`cardsDaPeca` — os dois caminhos as
  importam. Mesmas peças, mesma ordem de categorias e TIPOS (RN-068/a causa
  do "o short não aparece"), mesmo `precoCatalogo` (RN-018/RN-041, com o
  preço cheio riscado quando há campanha, RN-040), mesma chavinha "esconder
  sem estoque" valendo **por cor**, e a foto de cada cor é a do site
  (`fotoDaCor`). Copiar a regra faria o papel mostrar peça — ou **preço** —
  que o site não mostra, e dinheiro não diverge entre telas (a régua da
  RN-084 e da RN-090). O **catálogo de campanha** segue com a leitura dele
  (o acervo é outro, recortado pela campanha) e com os mesmos guardas.
  **(2) É fotografia do momento, dito no arquivo**: a capa leva a DATA
  ("preços e disponibilidade de 23/10/2026") e "confirme com a loja antes de
  fechar o pedido", e a resposta vai `no-store` — sem isso a cliente pede
  pelo preço de dois meses atrás e a loja descobre no fechamento. A data é a
  de São Paulo (`diaSP`, RN-030): pelo relógio do servidor, o catálogo
  gerado às 22h sairia com a data de amanhã. **(3) O PAPEL É O PRINT DA TELA**
  (pedido do dono, 23/10/2026: *"a qualidade desse PDF tem que ser a mesma
  da experiência de quem abre na web; como se fosse um print dele mesmo"*).
  A primeira versão tinha identidade PRÓPRIA — creme editorial, serifa — e
  parecia uma revista inspirada no catálogo, não o catálogo. Agora: as
  **cores são as da loja**, derivadas pela MESMA conta da vitrine
  (`temaDoCatalogo`, que a tela passou a importar: fundo, tinta, linha,
  suave e o cinza dos detalhes saem das três cores que a loja escolheu);
  toda página abre com a **barra da marca e a logo**, como a topbar do
  site; o título da seção é a categoria em CAIXA ALTA com "18 opções" na
  cor da marca e a **linha pontilhada** embaixo; e as peças são **cards
  BRANCOS de cantos arredondados** (caminho SVG — o pdf-lib não tem borda
  arredondada) com a foto num fundo suave, o nome em maiúsculas miúdas, a
  cor em negrito com a bolinha e o preço na cor da marca com `/ unidade`
  ao lado. **Quatro colunas por três fileiras**, como o catálogo no
  computador. A ÚNICA diferença para a tela são os **tamanhos escritos**
  no card: lá a cliente TOCA para abrir a grade, no papel não há toque. O
  desenho é pdf-lib, sem navegador (a peça do extrato de comissão, RN-038,
  e das etiquetas, RN-059). A paginação é pura e testada (`paginar`):
  categoria começa em fileira nova, **título nunca fica órfão** no pé da
  página, nada invade o rodapé e seção vazia não vira página em branco.
  **As medidas saíram de MEDIR o print da tela e OLHAR as páginas
  renderizadas**, e quatro defeitos só apareceram ali: a foto alta demais
  deixava um TERÇO da folha vazio; o bloco de texto ocupava mais do que o
  reservado e a última fileira encostava no rodapé; o `paginaSegura`
  **apara as pontas** de tudo que escreve (ele existe para limpar emoji),
  então o espaço de " / peça" sumia e saía colado — o respiro virou
  afastamento; e na capa a logo aparecia JUNTO do nome escrito, então
  "Toque Leve" saía duas vezes (a logo já É o nome: agora ela o
  substitui). **(4) Nada derruba a geração**: as fotos moram
  no banco como data-URL (dívida nº 1) e podem ser link externo, e a função
  morre em 60s — então há orçamento de tempo, as fotos são lidas em lote e
  em blocos, **deduplicadas** (o modelo de 4 cores com uma foto só entra uma
  vez) e **recortadas pelo sharp** na proporção da moldura, porque o pdf-lib
  não recorta (desenhar maior e tapar a sobra foi a primeira versão e
  invadia o card vizinho). O que não couber no tempo **sai sem foto e é
  CONTADO**, e a tela diz; acima de **600 peças** o arquivo corta e a última
  página explica o caminho. **A leitura também é em blocos**: uma consulta
  só traria as 600 data-URLs para a memória de uma vez e mataria a função
  antes de qualquer orçamento valer (achado da revisão). **Quatro achados
  da revisão fecharam a entrega**: (a) a **logo vai como PNG**, nunca pelo
  `shrinkImage` — ele devolve JPEG, que não tem transparência, e a logo de
  fundo transparente (o normal) virava uma **caixa preta** de 280 × 110 pt
  no meio da capa colorida; achatar para branco seria um retângulo branco,
  igualmente errado; (b) o **tamanho esgotado NÃO entra na linha** de
  tamanhos: no papel não há como apagá-lo, e listá-lo faria a cliente pedir
  o M que não existe — a RN-067 ao contrário (sem nenhum disponível, o card
  já diz "Indisponível"); (c) a loja que **esconde as cores**
  (`catalogHideColors`, semijoias) inverte o destaque no card como no site —
  o nome em negrito, a cor fora —, senão o PDF dela destacava "Único" e
  deixava o nome da peça no texto miúdo; (d) o gerador recebia o acervo
  inteiro sem nunca lê-lo. **(5) Toda a equipe baixa** (material de venda,
  a régua das etiquetas e da galeria de fotos; o conteúdo é o que o catálogo
  público já mostra a quem tem o link), sempre recortado pelo `companyId` da
  SESSÃO (RN-013) — nunca por id vindo da URL. `?l=` gera pela tabela de
  preço do link (RN-018: o de atacado para a lojista, o de varejo para a
  cliente final), e **código que não vale é RECUSADO** — cair no varejo
  calado seria mandar o preço de cliente final para a lojista; `?cat=`
  recorta por categoria, que é a saída da loja grande. **Ficou de fora de
  propósito**: mandar o PDF pela Central do WhatsApp — 2 MB por envio
  guardados como data-URL no banco; a vendedora baixa e encaminha pelo
  aparelho dela, que é o que o dono descreveu. Provado contra o Postgres
  local (`scripts/confere-catalogo-pdf.ts`, 12 conferências: ordem das
  seções, peso e tempo de verdade, a chavinha por cor, atacado × varejo, o
  teto que corta e conta, o orçamento esgotado devolvendo PDF em vez de erro
  e — medindo o PIXEL da capa renderizada — a logo transparente que não
  vira caixa preta). **(6) A CAPA É DA LOJA** (`lib/catalogo/capa-pdf-regra.ts`
  pura + `capa-pdf.ts` no servidor + `capa-no-navegador.ts`, seção "Capa do
  catálogo em PDF" em Configurações → Catálogo, 26/10/2026; pedido do dono:
  *"a opção de editar a capa, o layout dela completo, ou fazer ela tipo em
  Canva e subir"*). Decidido com ele: **a capa feita FORA (Canva) e subida
  aqui**, mais ajustes pequenos na automática — um editor de layout dentro
  do sistema seria obra de semanas que nunca chegaria perto do Canva, que a
  lojista já usa. (a) **A imagem**: a tela DIZ o formato (A4 em pé, 21 ×
  29,7 cm; 1240 × 1754 px ou mais, 2480 × 3508 a 300 dpi; JPG ou PNG; até
  20 MB; "no Canva: Documento A4, baixar como JPG") por UMA constante
  (`FORMATO_RECOMENDADO`); o **navegador recorta e encolhe antes de mandar**
  (a porta recebe no máximo 4,5 MB, limite da Vercel — o JPG do Canva a 300
  dpi tem 3 a 8 MB): confere a proporção, apara a borda fina pelo CENTRO até
  o A4 exato (tolerância de 8%; fora disso é outro formato — quadrado, story
  — e cortar levaria o título embora: recusa com a frase dizendo os
  pixels), avisa quanto aparou, e entrega JPEG de 1240 × 1754; o **servidor
  confere de novo pelo CONTEÚDO** (`lerImagem`, a régua da RN-070 — o rótulo
  da data-URL é digitável), pela MESMA régua (`motivoDaRecusa`, uma para os
  dois lados), e grava **sempre o JPEG recomprimido no A4** (data-URL,
  dívida nº 1, ~300–600 KB; PNG transparente ganha fundo branco; o giro da
  câmera vale) **em tabela PRÓPRIA** (`CatalogoCapa`, 1:1 — a `Company` é
  lida INTEIRA em dezenas de caminhos quentes, toda visita à vitrine e toda
  mensagem do webhook, e meio megabyte ali seria a logo da RN-070 de novo;
  achado da revisão), com a **miniatura gravada junto** (a tela não refaz o
  encolhimento a cada abertura, nem recebe o data-URL inteiro). A imagem é
  **salva na hora** em que sobe. (b) **A faixa do sistema fica por padrão**
  (`catalogPdfCapaFaixa`): uma faixa fina no pé, na cor da loja, com "Preços
  e disponibilidade de dd/mm/aaaa · confirme com a loja" e o WhatsApp — é a
  fotografia do momento (item 2); a loja pode tirar, e aí a capa é 100%
  dela (a data segue no rodapé das páginas). (c) **A capa automática ganha
  ajustes**: título no lugar de "CATÁLOGO · MÊS ANO" (`tituloDaCapa`), uma
  linha abaixo, e **as três peças** (ids de produto, até 3, só DA LOJA —
  RN-013, a porta recusa id de fora — e só peça ATIVA: a pausada saiu do
  catálogo e não estampa a capa dele, achado da revisão; a foto é a MESMA
  escolha do site, `fotoDaCor`), escolhidas pela busca de produtos; sem
  nenhuma, a amostra de sempre (começo, meio, fim). As peças escolhidas
  valem mesmo fora do recorte por categoria, e são lidas mesmo com a imagem
  da loja — se ela não abrir, a automática sai com as peças escolhidas. (d) **Capa torta nunca derruba o catálogo**: só o
  JPEG gravado pela porta é embutido (`capaGuardadaParaOPdf`, assinatura FF
  D8), e a imagem que não abre cai na automática. Só admin edita
  (identidade visual). Provado no `confere-catalogo-pdf.ts` (cenários 13–17,
  medindo o PIXEL: o meio da página 1 é a imagem enviada, o pé é a cor da
  loja com a faixa e a imagem sem ela, a imagem quebrada vira automática) e
  em `catalogo-pdf-capa.test.ts` (a régua e o preparo com o sharp).
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
  nada não muda em NADA. **"Nome da loja" também é opção do cardápio, e a
  ÚNICA sem coluna na ficha** (23/09/2026, pedido do dono): era campo FIXO
  do formulário ("Loja") e a maioria das lojas não o usa — agora só aparece
  para quem o marcar. A casa dele segue a de sempre — a nota do pedido
  ("Loja: X") e o nome de apresentação quando a cliente não diz o próprio
  nome —, NUNCA a ficha (`legalName` é razão social: anda com o CNPJ e sai
  em documento fiscal, RN-024). O payload continua `store` e o servidor
  continua aceitando e anotando SEMPRE (rascunho e reenvio antigos valem); o
  "Colar pedido do WhatsApp" lê o rótulo novo ("Nome da loja:") e o antigo.
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
  **RN-049 · A Central só aparece para quem JÁ TEM WhatsApp**
  (`lib/comm/central-disponivel.ts`, 05/09/2026): relato do dono — a loja que
  nunca conectou o WhatsApp abria a aba e via fila e chat cheios de pedidos
  do catálogo. Não é defeito: o pedido entra pelo portão único (RN-008) e
  nasce com conversa, funil e tarefa para nada se perder (RN-010) e para a
  bolha já existir quando a cliente aperta enviar (RN-043). Decisão alinhada
  com o dono: **por trás nada muda** — tudo continua nascendo, para estar lá
  no dia em que a loja conectar; o que muda é a **tela**: sem WhatsApp, a aba
  vira o convite "Conecte o WhatsApp da loja" (botão para quem pode conectar,
  `podeOperarIntegracoes`; a vendedora vê a quem pedir), e os pedidos seguem
  na tela Pedidos e no sino. **O sinal NÃO é "está conectado agora", é "esta
  loja já teve WhatsApp"**: a prova é o **carimbo da primeira conexão**
  (`CommSettings.whatsappConectadoEm`, gravado por `registrarPrimeiraConexao`
  quando o Evolution vira CONECTADO — sondagem ou webhook — ou a API oficial
  é escolhida, e **nunca apagado**: o botão Desconectar zera instância,
  telefone e provedor, e só o carimbo separa "nunca conectou" de "desconectou
  ontem"). Com ele, a Central FICA com a conexão caída ou desfeita — o segundo
  pedido do dono: **histórico nunca some atrás da tela de conectar**. Inferir
  pela mensagem com id foi tentado e **recusado na revisão**: o provedor
  simulado (`mock.…`) e a tela de simulação (`wamid.sim.…`) também carimbam
  id, e a loja sem WhatsApp reabria a fila por engano. As lojas que já tinham
  conectado antes do carimbo foram preenchidas pela migração (status,
  telefone, API oficial ou mensagem de id REAL — fora os falsos). Quem chega
  por **link para uma conversa** (`?conv=`: ficha, Agenda, sino) vê a Central
  mesmo sem WhatsApp — o convite no lugar seria beco sem saída. Conectado
  agora ou com a API oficial configurada também mostra; esperando o QR ainda
  não. A loja de demonstração sempre vê a Central (é vitrine).
  **RN-063 · SELO DA CLIENTE NA CENTRAL: CALCULADO DOS PEDIDOS, NUNCA
  COLOCADO NA MÃO** (`lib/selo-da-cliente.ts` + `selo-da-cliente-data.ts`,
  21/09/2026): pedido do dono — *"bater o olho no WhatsApp e saber, de forma
  destacada, quem já fez pedido e quem de fato é cliente (já pagou)"*, e
  *"quem tem duas compras pagas ganha um selo de recompra"*. Três degraus, o
  maior vence: 🟡 **Pedido** (tem pedido em aberto — orçamento/aguardando —
  e nenhum pago), 🟢 **Cliente** (1 pedido pago, RN-001) e 🟢🔁 **Recompra**
  (2 ou mais pagos; o selo "Cliente · N compras" com as setinhas); sem
  pedido, sem selo — e a ausência é informação (é lead). **Não é etiqueta**:
  etiqueta manual esquece, erra e envelhece (a "Pago" colocada à mão ficava lá
  depois do cancelamento e nunca virava recompra). E **não é carimbo**:
  gravar "quando o pedido vira pago" exigiria lembrar de gravar nos cinco
  caminhos por onde pedido nasce e muda (tela, catálogo, colar do WhatsApp,
  Nuvemshop, Pix) — a classe de defeito da RN-059. Calculado dos pedidos, o
  selo muda no mesmo instante por qualquer caminho, inclusive cancelar e
  apagar, e **ninguém tira nem põe** (o desenho é diferente das etiquetas:
  cheio, com ícone, sem "×"; se está errado, o pedido está). Cancelado não
  conta para nada; "em aberto" é **derivado** do enum (tudo que não é pago
  nem cancelado — lista à mão é onde status novo se perde). **Uma consulta
  para a lista inteira** (`groupBy` cliente × status, recortado pela loja,
  RN-013, pelo índice `(companyId, customerId)` — migração 20260921100100;
  sem ele o Postgres varria todo pedido da loja a cada abertura, achado da
  revisão), no mesmo mapeamento por onde passam lista, sync, busca e
  abertura. **Muda sozinho na tela aberta**: o sync de 3s devolve o selo
  fresco de quem teve **pedido mexido** desde a última batida
  (`Order.updatedAt`, índice `(companyId, updatedAt)`, migração
  20260921100000) — a conversa não muda quando o pedido vira pago, e sem
  isso "Pedido" só virava "Cliente" no F5; o "de quem" é DISTINCT no banco
  (`groupBy`, com teto de 500 por batida — `distinct`+`take` do Prisma corta
  linhas antes de deduplicar) e **recortado por quem vê** (`conversationScope`:
  a vendedora não recebe contagem de cliente fora do recorte dela); a tela
  aplica a TODAS as conversas daquela cliente, antes do atalho "nada mudou",
  e só redesenha se algum selo de fato mudou. **Pedido apagado ou
  transferido para outra cliente** não deixa `updatedAt` na cliente antiga:
  o funil único de exclusão (`reverseAndDeleteOrder`) e o PATCH que troca a
  cliente tocam as conversas dela (`tocarConversasDaCliente`), e elas voltam
  pelo sync normal. **Filtros** ao lado de "Não lidas": **Clientes** (inclui
  recompra), **Recompra** e **Com pedido**, contando PESSOAS (cliente
  distinta, não conversa — a cliente com duas conversas é uma) na aba/busca
  atual pela MESMA régua da lista (`passaFiltrosBase`, uma função para as
  duas contas), visíveis só quando há alguém com o selo (ou enquanto
  ligados) — e **as etiquetas da loja ficam em linha própria**, embaixo,
  com o ícone 🏷️ na frente (pedido do dono, 21/09/2026: misturadas, a
  etiqueta manual "Cliente" ficava colada no selo "Clientes" e ninguém
  distinguia o que é do sistema do que é da loja). **Toda a equipe vê** (o
  selo diz "é cliente da loja", sem valor
  e sem de quem foi a venda — não fere a RN-007). Limite aceito e dito:
  recompra conta PEDIDOS pagos, não dias (dois pedidos pagos no mesmo dia
  são recompra). Provado no navegador contra o Postgres local: pedido
  criado → 🟡 em 2s, pago → 🟢 em 4s, segundo pago → 🟢🔁 "2 compras",
  apagados → desce e some, tudo sem recarregar.
  **RN-012** · Resgate manual: **"Colar pedido do WhatsApp"** na tela Pedidos
  (`lib/catalogo/ler-mensagem.ts` + `/api/orders/ler-mensagem`) — lê a
  mensagem do catálogo, casa com o catálogo da loja (nome mais longo vence
  ao separar produto/cor), **preço SEMPRE do nosso cadastro**, prévia sem
  gravar nada e criação pelo caminho normal (`POST /api/orders`). Serve para
  a venda que só existe na conversa; linha sem cadastro ou sem estoque fica
  de fora e é anotada no pedido.
  **RN-062 · MONTAR PEDIDO É PREENCHER A GRADE (cor × tamanho)**
  (`lib/pedido-grade.ts` + `components/pedido/grade-de-pecas.tsx`,
  20/09/2026): pedido do dono com o print do celular — *"quando eu vou
  montar um pedido para o cliente no celular ou no computador, queria uma
  forma mais funcional e prática, pensando na experiência"*. No print, a
  busca devolvia QUATRO linhas escritas **"Baby Look · R$ 34"**, só o SKU
  mudando: numa confecção o nome sozinho não distingue modelo nenhum. E
  cada variação era uma ida à busca, que **fechava e apagava o termo** a
  cada peça — a grade de 3 cores × 3 tamanhos custava nove buscas e nove
  vezes digitando "baby look", no pedido mais comum do atacado. Agora a
  tela tem **três passos com um assunto cada** (cliente → peças →
  conferir), em vez de um formulário comprido com o total no fim do rolar,
  e no meio está a **GRADE**: linhas de cor, colunas de tamanho na ordem da
  arara (PP < P < M < G), quantidade digitada em cada cruzamento, totais
  por cor e por tamanho e o atalho **"repetir"** ("3 de cada tamanho").
  Cruzamento que a loja não cadastrou fica **vazio, não zero** — é "não
  existe", e oferecê-lo seria vender o que não há como separar. O resultado
  da busca passa a DIZER qual peça é qual (foto, código, categoria, cores e
  estoque) e carrega o selo **"N no pedido"**; a busca **não fecha** ao
  adicionar, porque o modelo seguinte costuma ser vizinho deste. **Dinheiro
  não muda de dono**: a grade recebe o preço como função de quem chama
  (RN-041 na tela de Pedidos, `unitPriceFor` na Central) com a quantidade
  DAQUELA célula — a mesma conta de antes, então nenhum preço muda de valor
  por causa da tela nova. Três decisões protegem o que já foi feito: a
  grade **abre preenchida** com o que está no pedido e **SUBSTITUI** aquela
  peça (somar faria "3" virar "6" só por abrir e confirmar), **célula
  zerada SAI** (é como se remove pela grade), e **preço editado à mão nunca
  é reescrito** — só célula NOVA nasce com o sugerido, senão o desconto
  combinado sumia ao voltar na grade para acrescentar um tamanho. A ordem
  das linhas é preservada (as que ficam seguem no lugar, as novas entram no
  fim) para a conferência não se reorganizar a cada ida. A conferência é
  **por MODELO**, não por cor × tamanho: no atacado o preço é um só para a
  peça inteira, e repetir "R$ 34" nove vezes é o que faz a lojista desistir
  de conferir no celular — preço divergente entre variações é **dito**, não
  escondido atrás de um número qualquer. **A quantidade PARA no estoque**
  (`quantidadeDigitada`, achado da revisão — salvo a **peça extra**
  da RN-075, que no Novo pedido e na Editar itens deixa passar com ciência): a porta de criação recusa o
  pedido INTEIRO quando falta peça (*"Estoque insuficiente de X (Cor Tam):
  restam N"*, 409), então oferecer 12 com 2 na arara levaria a lojista a um
  beco no último clique — a célula para no teto e **diz "máx N"**, e
  variação sem estoque nem aceita digitação. A primeira versão prometia o
  contrário ("o pedido entra do mesmo jeito") e teria feito a venda falhar
  no fim. Sobra a rede de segurança: estoque que **cai enquanto o pedido é
  montado** (a loja online vendeu no meio) aparece na conferência dizendo
  qual peça e quanto restou. **Fechar GUARDA o rascunho** — um toque fora do
  quadro apagava cliente, grade e observações sem confirmação —, o preço
  digitado à mão morre junto com a peça que sai (senão o campo mostrava R$
  30 e o pedido nascia com o sugerido), e o total fica **sempre no rodapé**,
  junto do passo seguinte.
  **A MESMA grade vale em EDITAR ITENS do pedido** (`items-editor.tsx`,
  05/10/2026, pedido do dono com o print do iPhone: a busca antiga numa
  listinha apertada, o teclado por cima e "Regata Alça · R$ 32" quatro
  vezes): duas telas dentro da janela — as peças do pedido agrupadas por
  modelo, com − e + grandes por cor × tamanho, preço por modelo (a leitura
  de `numeroBR`, a mesma do Novo pedido) e a grade a um toque; e "Adicionar
  peça" com os cartões da busca. A janela é a da grade (`--vvh`/`--vvtop`,
  página de trás travada), fechar GUARDA o rascunho, e a busca repetida não
  vai ao servidor de novo. Duas réguas próprias da edição (achados da
  revisão): (1) **o teto soma o que o pedido já SEGURA** — o `stock` da
  peça é o disponível já descontada a reserva deste mesmo pedido (RN-003),
  então a linha que segura 10 via "estoque 0" e o − a derrubava para 1;
  o servidor só confere o AUMENTO, e a tela oferece disponível + segurado
  (`somarOQueOPedidoSegura`, também na grade aberta de um modelo que já
  está no pedido, pela porta `?id=` da busca de produtos); (2) **a linha
  sem vínculo** (variação apagada do cadastro) não passa pela grade — ela
  não tem célula lá e seria zerada em silêncio; só a lixeira a tira, e cada
  uma é grupo próprio, pela posição. E a grade de um modelo que já está no
  pedido **fala o preço que o modelo tem no pedido** (o combinado; a célula
  nova nasce nele, `precoUnicoDoModelo`) — o sugerido da RN-041 só vale para
  o modelo que ainda não está nele; a grade anunciava R$ 49,90 com as linhas
  a R$ 32 (prova no celular).
  **A MESMA grade vale no montador da Central de WhatsApp** (21/09/2026): lá
  o seletor pedia cor, tamanho e quantidade um por um, com o mesmo custo de
  nove idas para a grade de um modelo. O que muda entre as duas telas é UMA
  decisão, e ela é de dinheiro: na tela Pedidos o preço é DIGITADO, então a
  linha que já existe **preserva** o dela; na Central o preço não é editável
  e segue a escada do atacado (`unitPriceFor` vira atacado a partir do
  mínimo do modelo), então a linha que cresce **recalcula** —
  `precoDasExistentes` diz qual das duas, e "recalcular" é exatamente o que o
  seletor antigo fazia ao somar peças numa variação já no carrinho. Nada
  mais de dinheiro mudou ali: o preço continua saindo de `unitPriceFor` com
  a quantidade **da própria linha** (o mínimo por modelo da RN-018 é outra
  régua, do catálogo, e não foi trazida para cá). A foto saiu da linha do
  carrinho e virou cache por PEÇA — junto com o cadastro dela, que é de onde
  sai a régua do preço —, e a vitrine de fotos ganhou o selo **"N no
  pedido"** e o código embaixo do nome. Três correções de dinheiro da
  revisão fecham a adoção: (1) o **cabeçalho da grade** dizia o preço do
  TOTAL somado — grade 2+2+2 com mínimo 6 anunciava "R$ 30 · atacado" e o
  pedido nascia a R$ 40, porque a escada é da LINHA; agora ele diz o que as
  células cobram, e **faixa** quando elas divergem (`precoDoCabecalho`);
  (2) o **"−" do carrinho** zerava a linha cuja peça tinha esgotado no meio
  (o teto do estoque estava sendo aplicado também na descida) e a peça sumia
  do pedido sem aviso — o teto agora só vale para SUBIR; (3) o **+/− passou
  a recalcular a escada**, que ele ignorava desde sempre: descer de 6 para 5
  numa peça com mínimo 6 deixava as cinco no preço de atacado e o pedido
  fechava mais barato do que a regra da loja.
  **A JANELA NÃO FOGE COM O TECLADO** (`--vvh`/`--vvtop` em
  `keyboard-inset.tsx` + `travar-fundo.ts`, 21/09/2026, relato do dono
  digitando quantidade na grade pelo celular: *"o teclado aparece e joga o
  campo lá pra cima"*). **A primeira tentativa não resolveu e está registrada
  porque custou uma ida**: supus que o iPhone empurrava a TELA VISÍVEL
  (`visualViewport.offsetTop`) e criei o `--kbtop` para a janela descer junto
  — mas o dono disse que continuava igual. O empurrão não era esse: o Safari
  **ROLA A PÁGINA DE TRÁS** para "acomodar" o campo, e a janela vai junto.
  Duas correções, as duas necessárias: (1) a janela **trava a página**
  enquanto está aberta (`position: fixed` no corpo — `overflow: hidden` NÃO
  trava o iOS, era enfeite; o lugar da lista é guardado e devolvido, com um
  reflow forçado antes, senão o pedido de rolagem cai no vazio como na
  RN-046); (2) a janela **para de calcular** a área visível e passa a usar a
  que o navegador MEDE (`--vvh` = altura, `--vvtop` = onde começa), em vez de
  descontar o teclado do `innerHeight` — no iPhone esse número muda sozinho
  (barra do Safari, teclado, roletinha) e conta errada joga a janela para um
  lugar que não existe. Medido no navegador: com a área visível em 520px, o
  fundo da janela fica em 520px cravado; a página de trás não rola; ao fechar,
  a lista volta para onde estava. `--kb` e `--kbtop` continuam servindo as
  outras 24 janelas do app (comportamento de antes, mais a compensação do
  empurrão), com varredura que derruba o build se uma nova esquecer o par.
  **As gavetas do catálogo público (ficha da peça e sacola) passaram para a
  MESMA régua em 15/10/2026** (print do dono no iPhone: com o teclado aberto,
  a sacola virava uma tira com o cabeçalho e o botão, e o campo digitado
  sumia): elas moram num contêiner que É a área visível medida
  (`--vvh`/`--vvtop`) em vez de `bottom: var(--kb)`, o miolo é quem encolhe
  (`flex-1 min-h-0`) e, **enquanto a cliente digita na sacola**, a gaveta
  ocupa a área visível inteira e o rodapé fica só com o botão (a barra do
  mínimo e a conferência do telefone voltam quando o teclado fecha, com um
  respiro de 200 ms para trocar de campo não piscar). Fechada, desce a
  própria altura a partir do fim da área visível e some (`visibility`).
  **RN-075 · PEÇA EXTRA: O PEDIDO PODE PEDIR MAIS DO QUE O ESTOQUE TEM, COM
  CIÊNCIA** (`lib/pedido-extras.ts` + `reservarComExtras` em
  `lib/reservations.ts`, janela `components/pedido/confirmar-extras.tsx`,
  09/10/2026): pedido do dono — *"quando a vendedora está montando um pedido
  e não tem a peça em estoque, ela é impedida de lançar"* — e, desenhado com
  ele, a peça que falta numa confecção é **EXTRA: feita para aquele pedido**.
  Então: o que existe no estoque fica **segurado** como sempre (RN-003); o
  que passa disso é extra e **não mexe em estoque nenhum** — não reserva, não
  baixa, nunca fica negativo, **não vai para a Nuvemshop nem para o Jueri**
  (só o que de fato saiu daqui é espelhado; a peça da Nuvemshop também pode
  ter extra). **A pessoa confirma antes de gravar**: a porta responde 409 com
  a lista (`extras`: peça, quanto precisa, quanto o estoque cobre, quanto é
  extra), a janela "🧵 Estou ciente" mostra, e o MESMO envio volta com
  `extrasConfirmados` — **quem conta é o servidor**, na transação, e o extra
  MAIOR que o confirmado (a peça acabou entre a janela e o clique) desfaz
  tudo e a janela reabre com os números de agora; ninguém confirma extra que
  não viu. O histórico do pedido diz **quem confirmou e quais peças**.
  **O extra não tem coluna no banco**: é o que o pedido pede além do que o
  LIVRO DE MOVIMENTOS diz que ele segura (`extrasDoPedido`, com as trocas da
  RN-073 no ajuste — o livro já as tem). Assim os caminhos que já respeitam o
  livro acertam o extra sozinhos: **diminuir tira primeiro do extra** (nada
  volta ao estoque por ele), **cancelar devolve só o que saiu**, reabrir
  pedido baixado não desconta de novo — um número à parte teria de ser
  lembrado em cada porta (a classe de defeito da RN-059). **Onde vale**:
  **Novo pedido** e **Editar itens** (a grade passa do estoque com
  `permiteExtra`, a célula diz "+N extra"; o "repetir" segue parando no
  estoque — extra é decisão, não atalho) e o **restaurar/reabrir pedido
  cancelado** (botão da lista, menu de status e trilha da ficha): o que a
  peça vendida no meio deixou faltando volta a ser extra, com a mesma janela.
  A **Central de WhatsApp** e o **"Colar pedido do WhatsApp"** não oferecem
  extra (decisão do dono): continuam recebendo o 409 com a frase de sempre.
  **O selo "🧵 N extras"** aparece na lista e a ficha diz quais peças —
  consultas para a página inteira (`extrasDosPedidos`), só em pedido que
  segura estoque AQUI e **ainda está na loja** (`STATUS_COM_EXTRA_PENDENTE`,
  conferida contra a lista do reservado do Estoque; enviado e entregue saem
  do selo, senão o pedido de meses atrás seguia marcado). **Extra
  CONFIRMADO ≠ falta**: o pedido que pede mais do que segura SEM ninguém ter
  confirmado (o do catálogo que entrou com estoque a menos, RN-067; o Pix
  que liquidou sem peça) não é compromisso de produção — o selo diz "N sem
  estoque" em âmbar e a ficha manda produzir, trocar ou combinar com a
  cliente; o violeta "🧵 extras" é só de quem tem a linha de confirmação no
  histórico (`MARCA_DOS_EXTRAS`, achado da revisão). **Lançar a peça no
  estoque depois NÃO a segura para o pedido** (decisão do dono: é peça que a
  confecção faz, não estoque esquecido; o extra fica anotado) — e por isso a
  ficha DIZ para não lançar a peça extra pronta no estoque: lançada, ela fica
  livre para outra venda. **Toda a equipe** confirma extra onde já pode
  agir: vendedora e gerência ao montar e editar; o suporte, que não monta
  pedido, ao editar e restaurar. **Restaurar também reabre a janela na
  corrida** (a peça acabou entre a conferência e a transação): antes de a
  revisão pegar, a falta entrava calada com aviso à gerência e o pedido
  voltava devendo peça que ninguém viu; e a edição, na corrida, reabre com
  TODAS as peças dela, não só a que acabou. **Limites ditos**: pedido antigo
  (antes de 08/10/2026) sem nenhum movimento no livro não mostra extra — não
  dá para saber se ele nasceu antes de o livro registrar o pedido; e a
  separação por leitor (RN-060) aceita bipar o extra quando ele fica pronto
  (é a mesma variação), ou ele é declarado em falta.
  Provado pelas rotas de verdade contra o Postgres local
  (`scripts/e2e-pecas-extras.ts`, 35 conferências): recusa sem ciência,
  criar segurando o que há, corrida, editar para mais e para menos, ficha e
  lista, cancelar devolvendo, restaurar, cancelar baixando e reabrir, o
  pedido todo de peça sem estoque, o selo que some ao enviar e a falta sem
  confirmação dita como falta.
  **RN-076 · VENDE SOB ENCOMENDA: A CHAVINHA QUE DEIXA O ESTOQUE FICAR
  NEGATIVO** (`lib/sob-encomenda.ts` + `lib/sob-encomenda-data.ts`,
  `Product.sobEncomenda` e `SobEncomendaCategoria`, 09/10/2026): pedido do
  dono — *"tenho clientes de confecção: às vezes não tem pronto, mas pode
  produzir. Em cada produto ou categoria uma chavinha para vender
  infinitamente, mesmo que o estoque fique negativo; nasce desligada para
  todos"*. É o irmão da peça extra (RN-075) para quem produz SEMPRE: lá a
  ciência é dada pedido a pedido, aqui uma vez, pela gerência. Decidido com
  ele: (1) **a chavinha mora na CATEGORIA e na PEÇA, e a peça manda mais**
  (`Product.sobEncomenda`: nulo segue a categoria; true/false decide) — a
  escada da RN-051/RN-055: liga em "Conjuntos" (Produtos → Categorias,
  ícone de tesoura) e desliga só no kit que não se produz (ficha da peça);
  **nasce desligada**, e **só a gerência** liga (o servidor recusa o suporte
  e a vendedora com frase; a ficha só manda o campo quando a pessoa MUDOU,
  senão a vendedora que salva a ficha levava 403). (2) **O estoque fica
  NEGATIVO**: "−3" = 3 a produzir. A baixa deixa de ser condicionada SÓ para
  a peça livre (`PecasLivres` em `reservations.ts`: o lote ganha a terceira
  coluna `livre`, `WHERE (d.livre OR v.stock >= d.qty)`; a unitária tira o
  `gte`) — a RN-003 segue intacta para todas as outras, e o conjunto vazio é
  o padrão. **Nada mais muda de conta**: cancelar devolve pelo livro (−3
  volta a 0), a produção lançada (`lancaNoEstoque`) cobre o negativo
  primeiro porque é soma, o livro guarda a quantidade INTEIRA (a peça livre
  nunca é extra — `extrasPrevistos` a pula, `reservarComExtras` a tira das
  "curtas") e o reservado do Estoque fecha: 2 na arara + 5 vendidas = −3
  disponível, 5 seguradas, 2 na loja. (3) **Vale em TODA porta de venda**,
  com o conjunto calculado por quem carrega as variações
  (`variacoesSobEncomenda`, que precisa de `nuvemshopId` da variação e
  `sobEncomenda`/`category`/`jueriId` do produto): catálogo público (os DOIS
  produtores, mais o diagnóstico da ficha que espelha o filtro da vitrine),
  Novo pedido, Central, Colar pedido (a linha não trava no estoque dessa
  peça), Editar itens, restaurar cancelado e o Pix do gateway. Nas telas a
  API de produtos manda `sobEncomenda` RESOLVIDO por variação, e a grade, o
  "repetir", o +/− do carrinho e o editor passam do estoque **sem a janela
  "estou ciente"** (`tetoDaVariacao`; a célula diz "N · encomenda", nunca
  "+N extra"). (4) **A vitrine não muda NADA para a cliente** (decisão do
  dono: sem selo, sem prazo): a peça só não some ao zerar e a quantidade não
  para (RN-067 — `disponivelNaVitrine(stock, true)` devolve o teto da
  linha), e "esconder sem estoque" não a esconde
  (`ondeNaoEscondePorEstoque`: tem estoque OU ficha ligada OU categoria
  ligada com a ficha em "segue"). (5) **A peça da NUVEMSHOP também vende
  sob encomenda** (pedido do dono no mesmo dia, com o print da Regata Alça
  esgotada: *"mesmo sendo Nuvemshop, se a chave estiver ligada, pode estar
  disponível para venda"*): o negativo fica AQUI e **lá vai ZERO**
  (`estoqueParaANuvemshop`, nos dois envios da RN-053 — a loja online não
  aceita negativo, e a peça devendo não tem o que vender lá); a confirmação
  segue conferindo o número daqui. **A sincronização não apaga a dívida**
  (`estoqueDaSincronizacao`): com negativo aqui, o número de lá é o que
  ENTROU depois (peças prontas lançadas na Nuvemshop) e cobre primeiro o que
  se deve — −3 aqui e 0 lá ficam −3; 10 lá viram 7, que entram na fila da
  RN-053 e saem NA HORA pelo `after()` (esperar a repesca deixava minutos
  para uma venda de lá ser apagada pelo número velho), e enquanto estão na
  fila a sync não grava por cima. Gravar o 0 de lá por cima do −3 apagaria o
  "a produzir" e o cancelamento seguinte devolveria peças que nunca
  existiram. Quatro achados da revisão fecharam a conta: o número daqui que
  decide é **relido** (a foto da rodada envelhece numa etapa de 25s) e a
  gravação é **condicionada a ele** (venda no meio, ou o webhook e o botão
  sincronizando juntos, não descontam a dívida duas vezes nem desfazem a
  venda — mudou, a próxima rodada decide); a dívida só vale com o **vínculo
  de sempre** (peça ligada ou religada agora nunca recebeu o nosso zero: o
  número de lá é dela, RN-050) e com **número de verdade lá** ("infinito"
  vale o de lá).
  Vale com ou sem a chavinha (o negativo é dívida dos pedidos), e a
  conferência da integração não chama de divergência o negativo daqui com o
  zero de lá. **A peça do JUERI segue de fora** (`pecaDoJueri`): a sync dele
  grava o número de lá duas vezes por dia, sem porta de volta, e o "a
  produzir" sumiria na rodada seguinte — a ficha nem oferece, a categoria
  ligada não a alcança, a porta recusa com 409. (6) **No Estoque a
  peça livre sai do MÍNIMO** (`chegouAoMinimo`: a régua da RN-051 menos ela)
  **nos cinco lugares** — filtro "No mínimo", painel "o que repor", alerta
  (solta o carimbo de quem tinha), monitor da tela Produtos e a SQL do
  Dashboard (`LEFT JOIN "SobEncomendaCategoria"`, com a exceção da
  vinculada escrita em SQL) — porque negativo nela é esperado e alerta todo
  dia vira barulho (a exceção que sobra na SQL é só a do Jueri); ganha o recorte próprio **"A produzir"** (chip, só a
  livre devendo), que também **vira lista de produção** na folha (a coluna
  "Falta" é o negativo, "Mín." diz "enc."); a linha mostra "N a produzir" em
  violeta e "sob encomenda" no lugar do mínimo; os cartões: "na loja" fecha
  com o negativo, "disponíveis" não desce de zero e diz quantas há a
  produzir, dinheiro parado nunca é negativo (`max(0, emEstoque) × custo`),
  cobertura negativa é zero. (7) **O ajuste digitado continua só de 0 para
  cima** — gravar a contagem apaga a conta do que havia a produzir, e a
  linha de ajuste AVISA antes (a porta aceita `visto` negativo para a
  gravação condicional continuar valendo). A troca (RN-073) também
  passa do estoque, para toda peça fora a do Jueri (13/10/2026). **Limites ditos**: desligar a chavinha com a peça negativa deixa o
  número como está (as vendas seguintes travam até repor); a soma do
  "disponíveis" com peça negativa e os relatórios de giro leem o número
  cru. Provado pelas rotas de verdade contra o Postgres local
  (`scripts/e2e-sob-encomenda.ts`, 59 conferências: quem liga, a vitrine, o pedido, a edição, o cancelamento, a produção, o Estoque, o Dashboard e a peça da Nuvemshop pela sincronização de verdade — o 0 de lá não apaga o −3, 10 lançadas lá viram 7 e voltam pela fila, a peça ligada agora fica com o número de lá).

## Módulos

- **CRM**: clientes (carteira), funil de vendas, tarefas, automações,
  campanhas de disparo, tags/interesses, notificações (sino + push PWA).
  **Push de venda paga vai no `after()`** (`avisarVendaPagaSemQuebrar` em
  `lib/push.ts`, 11/09/2026): chamada solta era congelada pela Vercel junto
  com a resposta e o celular não tocava "às vezes" — mesma cura da porta do
  Financeiro (RN-033). Dispara ao ENTRAR em qualquer status pago (RN-001),
  pelas três portas: tela do pedido, Pix do gateway e loja online. O aparelho
  precisa estar inscrito (Configurações → notificações de venda; iPhone só
  com o app na tela inicial) e as chaves VAPID precisam existir na Vercel.
  **RN-091 · FUNIL EDITÁVEL — O CARTÃO ANDA PELA ETAPA ESCOLHIDA, NUNCA PELO
  NOME** (`lib/funil/etapas-regra.ts` + `lib/funil/editor.ts`, botão
  "Editar etapas" na tela Funil, 21/10/2026, ADR-020): pedido da Sutilli
  Semijoias — criar, renomear e apagar etapas. **Chave por loja**
  (`Company.funilEditavelEnabled`, o Super Admin liga no painel Lojas, sem
  custo) e **só gerência edita** (admin/gerente; vendedora e suporte não —
  uma etapa apagada com 30 cartões bagunça a loja inteira). **Desligar só
  esconde o editor**: o funil fica como a loja deixou (voltar ao padrão
  sozinho mexeria em cartão de cliente). O defeito que impedia isso: o
  sistema achava as etapas automáticas pelo NOME ("Catálogo enviado"...) e
  renomear fazia o funil parar de andar em silêncio. Agora cada marco que o
  sistema reconhece — a vendedora respondeu, a cliente abriu o catálogo,
  virou orçamento, aguardando pagamento — aponta para uma etapa por id
  (`EtapaAutomatica`; vários marcos podem ir para a mesma etapa; sem linha =
  **"não mover"**), escolhida no próprio editor. A migração ligou os funis
  existentes pela MESMA régua do nome (sem acento/caixa, etapa aberta de
  menor ordem) e todo lugar que cria funil cria os vínculos junto — nenhuma
  loja percebe a troca. O "só avança" segue pela ORDEM das etapas, e o
  editor diz isso. Travas: **ganho e perdido não se apagam** (renomeiam —
  pedido pago e cancelado levam o cartão para lá), **a primeira etapa é
  sempre aberta** (porta de entrada do lead), sempre sobra uma aberta, marco
  só em etapa aberta E ANTES do ganho (depois dele — o "Pós-venda" do
  padrão — a coluna quer dizer "já vendi", e um pedido aguardando pagamento
  cairia lá; é também o que segura o ganho no fim: reabrir pedido estornado
  e o "em fechamento" do Dashboard contam as etapas antes dele, achado da
  revisão), nome único (sem caixa/acento), teto de 15 etapas.
  **Apagar exige destino aberto** e leva TUDO junto — cartões, a regra de
  "em qual etapa cada origem entra" e os marcos ("o que ia para X vai para
  Y", dito antes do clique). Cada mudança é UMA transação com o funil
  TRAVADO (`FOR UPDATE`), conferida sobre o banco naquele instante, e fica
  na Central de Comunicação (`funil.editado`, com quem fez); cartão novo
  entrando na etapa no segundo da exclusão faz a transação voltar inteira
  (409, "tente de novo"); e quem CRIA cartão (intake e pedido do catálogo)
  lendo a etapa um instante antes de ela sumir tenta de novo uma vez
  (`naEtapaViva`) — o lead e o pedido nunca quebram por causa do editor.
  Funil SEM nenhum vínculo numa loja SEM o editor (a criada pelo código
  antigo na janela do deploy) é religado pela régua do nome de carona ao
  abrir o Funil (`garantirMarcosIniciais`); com o editor ligado, nenhum
  vínculo é escolha da loja e fica. O estado do editor é buscado ao ABRIR
  (a tela do Funil abre o tempo todo). Provado contra o Postgres local
  (`scripts/confere-funil-editavel.ts`).
- **RN-092 · CALENDÁRIO COMERCIAL: DATAS DO SISTEMA CALCULADAS, ANTECEDÊNCIA
  DA LOJA, LEMBRETE UMA VEZ POR DATA** (`lib/calendario/datas.ts` +
  `dados.ts` + `lembrete.ts`, aba `/calendario`, 23/10/2026): pedido do dono
  — uma aba com chave com **três categorias**: datas comerciais, datas de
  oportunidade (pelo nicho e segmento do público) e lançamentos (coleção ou
  modelo novo). Decidido com ele: (1) **módulo com chave**
  (`Company.calendarioEnabled`, o Super Admin liga por loja no painel
  Lojas; catálogo `CALENDARIO` com preço de tabela 0 até o dono definir) e
  **só a gerência vê e edita** (porteira `lib/calendario/gate.ts`, rotas
  por `comPorteira`, handler por handler — o teste varre); desligar só
  esconde a aba, as datas e anotações ficam. (2) **As datas do sistema são
  CALCULADAS, nunca gravadas ano a ano**: Páscoa (algoritmo gregoriano),
  Carnaval (Páscoa − 47), Mães e Pais (2º domingo de maio e de agosto) e
  Black Friday (a sexta depois da 4ª quinta de novembro) mudam de dia
  sozinhas — digitadas, um dia faltaria o ano seguinte. As **comerciais**
  valem para toda loja (Carnaval, Dia da Mulher, Consumidor, Páscoa, Mães,
  Namorados, São João, Pais, Cliente, Crianças, Black Friday, Natal,
  Réveillon); as de **oportunidade** entram pelos **segmentos** que a loja
  marca (`calendarioSegmentos`), numa **lista FECHADA mantida no código** e
  revisada com o dono — sem inteligência artificial, a régua do Estoque
  (RN-052): só entra data conhecida (estações, volta às aulas, metas de
  janeiro, projeto verão, formaturas, Dia do Jeans, Dia da Gestante, ciclo
  junino…); a mesma data em dois segmentos é UMA (mesma chave) com os dois
  nomes; segmento que não existe é ignorado. A loja **esconde** a data do
  sistema que não serve (`calendarioOcultas`, some de todos os anos, volta
  em Preferências). (3) **"Quando começar" é da LOJA** — o sistema atende
  atacado e varejo: a antecedência padrão (`calendarioAntecedenciaDias`,
  nasce 45) e a de cada data (`CalendarioEvento.antecedenciaDias`, nulo =
  segue a loja); começar = data − antecedência, e a tela diz "começar em
  DD/MM", "hora de começar" (a janela de trabalho), "é hoje" ou "já passou".
  (4) **Lançamentos e datas da loja são anotação com tarefas**: nome, dia,
  tipo, notas e uma lista de tarefas "para a data acontecer" (marcar como
  feita registra quem e quando); a data do sistema também recebe notas,
  tarefas e antecedência própria — a linha dela (`chaveSistema` + `ano`,
  único por loja) só nasce quando alguém anota ou quando o lembrete sai, e
  nela o nome e o dia NÃO mudam (são da regra). (5) **O lembrete "é hora de
  começar"** sai no sino e no celular da gerência quando a data entra na
  antecedência, **uma vez por data** (carimbo `avisadoEm`; mudar o dia ou a
  antecedência da data apaga o carimbo, mudar a antecedência PADRÃO não —
  senão um ajuste viraria uma enxurrada de avisos) e **em resumo por
  rodada**, a régua do alerta de estoque (RN-051); roda **de carona** (sync
  da inbox e abertura do Calendário), com trava atômica por loja a cada 6 h
  (`calendarioAvisoRunAt`) e freio em memória — nunca um 3º cron (ADR-002)
  —, só com a chave ligada (ela entra na própria trava); carimbo e aviso
  nascem na mesma transação; **rodada que falha MANTÉM a trava** (devolvê-la
  fazia o sync de 3 s repetir a rodada e encher a Saúde — a lição da
  RN-082) e vai para a Saúde sem alarme; **sem gerência ativa nada é
  carimbado** (carimbar sem ninguém receber calava o aviso para sempre); o
  freio em memória é curto e a **abertura da tela passa por cima dele**
  (ligar a chave e abrir o Calendário avisa na hora). A tela mostra do começo do mês corrente até 12 meses à frente,
  agrupada por mês, com filtro por categoria e o bloco "É hora de começar"
  com o andamento das tarefas. **A data da loja cabe nessa janela** —
  criada fora dela sumia ao salvar e a pessoa criava de novo
  (`foraDaJanela`, tela e porta) —, o lembrete olha a MESMA janela (nunca
  aponta para data que a tela não mostra) e o teto de 500 datas conta só as
  da janela (as antigas não teriam como ser apagadas). Esconder/mostrar data
  é gravação atômica no banco (duas abas não apagam uma a escolha da outra)
  e marcar tarefa já feita não troca quem fez. Tudo recortado pela loja
  (RN-013: tarefa só é achada pela data da loja). **Limites ditos**: as datas de referência
  (volta às aulas, estações) são aproximadas e a loja ajusta pela
  antecedência ou cria a dela; o lançamento é só anotação por enquanto
  (ligar às peças da coleção ficou para depois, decisão do dono).
- **Central de Atendimento WhatsApp** (`/whatsapp`, tela `inbox.tsx`):
  fila/chats/contatos (vendedora vê os dela + a fila; o interruptor
  **"vê todas as conversas do chat"** na tela Equipe — `User.chatVisaoTotal`,
  `conversationScope` — abre a Central inteira para uma vendedora específica
  SEM mexer em carteira/pedidos/comissão), setores, assumir/transferir/encerrar.
  **Novo contato no topo da lista** (23/09/2026, pedido do dono: *"quando
  recebo um número novo, não consigo adicionar no sistema — somente se o
  cliente me chamar primeiro"*): a vendedora digita nome e telefone e a
  conversa abre pronta para a primeira mensagem, pelas DUAS portas de sempre
  — o cadastro manual (`POST /api/customers`, portão único da RN-008: número
  já cadastrado NUNCA vira segunda ficha, e a janela DIZ de quem é a ficha e
  pede confirmação antes de abrir conversa com outro nome) e o "Conversar no
  WhatsApp" da ficha (`POST /api/conversations`: conversa nasce ASSUMIDA por
  quem abriu, nunca na fila; devolve a aberta se já existe — a de COLEGA
  fora do recorte NÃO abre por cima: a porta responde com quem está o
  atendimento, senão a tela levava 404 do recorte e ficava muda — e reabre
  a encerrada NO NOME DE QUEM ABRIU, com o histórico inteiro; manter a dona
  antiga jogava a conversa na lista de quem não pediu nada — achados da
  revisão). A janela só FECHA quando a conversa abriu de fato. **O nome é OPCIONAL** (pergunta do dono no mesmo dia: "às vezes consigo o número sem o nome"): sem nome o contato nasce com o crachá provisório (`Contato (82) 9…`, `nomeProvisorio`) e o nome que a cliente usa no WhatsApp o SUBSTITUI sozinho quando ela responder — nome digitado por gente nunca é sobrescrito; e número já cadastrado com o nome em branco abre direto (não há nome para divergir). Cliente novo entra na CARTEIRA de quem
  cadastrou (a régua de sempre do cadastro manual). A conversa recém-criada
  é buscada INTEIRA no servidor antes de abrir (o caminho do `?conv=` da
  Agenda), notas internas
  com @menção, respostas rápidas (criáveis por qualquer um), mídia + **áudio
  de voz** (a vendedora **escolhe o microfone** na engrenagem ao lado do botão
  de gravar, `lib/microfone.ts` — antes quem mandava era o padrão do Windows e
  o headset plugado ficava de fora sem ninguém saber; a barra mostra de qual
  microfone o som está vindo, e microfone que sumiu volta ao padrão AVISANDO.
  **O volume é acertado antes de sair** (`normalizarVoz` em `lib/audio-wav.ts`):
  o nível vem da ENERGIA DA FALA — quadros de 20 ms, silêncio fora por
  porteira, mediana em cima (pico e média deixavam um estalo de 200 ms mandar
  no áudio inteiro). **A cadeia foi refeita em 14/09/2026** (relato do dono:
  "microfone com anti-ruído, mas o áudio captura sons do fundo, e som que
  nem é alto chega estourando"), na ordem portão → ganho → freio de pico →
  curva de segurança: (1) o **ganho automático do navegador SAIU**
  (`autoGainControl: false`) — nas pausas ele levantava o fundo que o
  anti-ruído do microfone tinha abaixado, e som médio chegando com o ganho
  lá em cima saturava DENTRO do navegador, antes de qualquer freio nosso;
  o teto do nosso ganho subiu de 4× para 8× para cobrir quem fala longe;
  (2) **portão de ruído** (`portaoDeRuido`): o que fica 18 dB abaixo da voz
  é abaixado em curva até −20 dB, abrindo um quadro ANTES da palavra e
  fechando em 150 ms (liga/desliga picota) — antes a porteira só decidia a
  MEDIÇÃO e o fundo passava inteiro, multiplicado pelo ganho da voz;
  (3) **freio de pico com antevisão** (`limitarPicos`, 10 ms à frente,
  ataque 1 ms, solta em 80 ms): o estalo sai mais BAIXO, com a forma
  original — a curva `freioSuave` espremia a onda e era isso o "estouro";
  ela ficou só como rede de segurança; (4) a **mudança de taxa é feita pelo
  DECODIFICADOR** (`decodificarNaTaxa`): tocar o buffer de 48 kHz num
  contexto de 24 kHz reamostra por interpolação linear, sem filtro, e o que
  está acima de 12 kHz dobra para dentro como ruído áspero; (5) **redução
  de chiado por espectro** (`reduzirChiado`, mesmo dia, segundo relato:
  "os áudios saem com chiado no fundo"): o portão só cala o que fica entre
  as palavras, e chiado está em todas as frequências, também DURANTE a
  fala. A gravação vira quadros de 512 amostras, o PERFIL do chiado é
  aprendido da própria gravação (por frequência, o nível que fica abaixo de
  20% do tempo — a voz muda de altura o tempo todo, o chiado ocupa tudo o
  tempo inteiro), e cada frequência de cada quadro é abaixada na proporção
  do quanto está perto do perfil (regra em potência: voz 10 dB acima quase
  não é tocada; o que está no piso cai −16 dB, o teto — mais que isso soa
  "debaixo d'água"), com o nível suavizado entre quadros e o ganho entre
  frequências vizinhas (sem isso sobra o "borbulhado" de redutor barato).
  Abaixo de 70 Hz é zumbido de rede, vai embora. Medido com ruído branco:
  silêncio −13,5 dB, agudos durante a fala −10 a −16 dB, voz em 97%. Limite
  aceito: um som SUSTENTADO por mais de 80% da mensagem (uma nota cantada
  sem parar) seria lido como fundo e abaixado — não acontece em mensagem
  falada. E a **garantia
  do microfone**: o que o navegador ENTREGOU (`track.getSettings()`) é
  conferido contra o escolhido (`microfoneEntregueConfere`, aviso na hora
  se divergiu) e os filtros de fato aplicados aparecem ao passar o mouse
  no nome do microfone (`descricaoDaCaptura`). A gravação só
  começa depois de `MS_ASSENTAR_MICROFONE` (0,5s), que deixa a supressão de
  ruído assentar fora do arquivo — era ela o "primeiro segundo estourado".
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
  **Colar imagem no campo** (`lib/colar-imagem.ts`, 16/09/2026, pedido do
  dono: "tiro o print, clico no campo e colo, como no aplicativo"): o print
  colado **fica preso no campo** (miniatura com X, faixa "1 imagem pronta
  para enviar · Enter envia") e só sai no **Enter ou no botão**, pelo MESMO
  caminho do clipe (compressão, fila, ritmo, bolha), com o texto digitado
  indo atrás como legenda. **Sem pergunta** (a confirmação da primeira
  versão atrasava, relato do dono no mesmo dia) — a miniatura presa é a
  chance de desistir. Trocar de conversa solta as imagens (não vão para
  outra cliente); texto colado segue colando como texto; nota interna não
  leva imagem.
  **Digitando no celular, a conversa não foge** (15/10/2026, print do dono:
  tocar no campo sumia com o nome da cliente e com o ← Voltar): o iPhone
  ROLA A PÁGINA ao focar o campo e o cabeçalho da conversa saía por cima da
  borda. Com o teclado aberto, a Central vira camada presa à área que a
  pessoa VÊ (`--vvtop`/`--vvh`, a cura da janela da grade, RN-062; regra em
  `globals.css`, `body.teclado-aberto .inbox-raiz`): nome e ← Voltar no
  topo, campo colado no teclado; a barra do app sai de vista só enquanto se
  digita. E a barra de ícones do campo cabe em 390px (o botão de fechar o
  teclado ficava cortado).
  **Emoji**: o seletor (`seletor-de-emoji.tsx`, grade em `lib/emojis.ts`)
  tem **barra de pesquisa** em português sem acento ("coracao", "caixa",
  "feliz"; Enter escolhe o primeiro) e é o MESMO na caixa de **editar
  mensagem** — antes não dava para pôr emoji na mensagem editada.
  **Resposta CITANDO uma mensagem aparece como no aplicativo** (06/10/2026,
  pedido do dono com o print da cliente respondendo "2 m e 2g" em cima de
  cada foto): a Central já MANDAVA citação (botão Responder) mas não LIA a
  que chegava — o webhook ignorava o `contextInfo.stanzaId` e as bolhas
  nasciam soltas, sem dizer de qual foto era o "2 m e 2g". Agora `citacaoWA`
  (`lib/comm/wa-message.ts`, também dentro dos embrulhos) lê o id da citada,
  `idDaMensagemCitada` acha a nossa mensagem com aquele `externalId`
  (recortado pela loja, RN-013) e a bolha nasce com `replyToId` — a da
  cliente e o ECO da loja respondendo pelo celular; na API oficial é o
  `context.id`. A caixinha (`CaixinhaDaCitada`) mostra quem, o texto e a
  **miniatura** quando a citada é foto (link da mídia dela; não carregou,
  some e fica o texto), e um toque **pula até a mensagem original** pelo
  mesmo caminho da lupa (carrega o passado se preciso). Citada que não temos
  (anterior ao sistema, apagada) deixa a bolha solta, como sempre foi.
  **A citação mora na RAIZ do aviso da Evolution** (09/10/2026, o dono: *"acredito
  que ainda não está funcionando"*): a Evolution v2 reescreve o texto com
  citação (`extendedTextMessage` vira `conversation`) e APAGA o original —
  o `contextInfo` de dentro vai junto, e o que sobra é a cópia solta em
  `data.contextInfo`. A primeira versão só procurava dentro do conteúdo, e
  a resposta mais comum (texto em cima da foto) nunca ligava; foto e vídeo
  respondendo ligavam, porque esses ela não reescreve. Agora `citacaoWA`
  olha a raiz primeiro. Provado pelo webhook de verdade contra o Postgres
  local (`scripts/e2e-citacao.ts`, com o aviso no formato da Evolution: o
  código antigo deixava solto, o novo liga — inclusive o eco do celular).
  **Limite**: as respostas que chegaram antes do conserto ficam soltas (o
  aviso não é guardado, não há de onde reler a citação).
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
  antigo; vale para os DOIS lados — pedido, Pix, endereço). **Copiar SÓ UM
  TRECHO** (16/09/2026, relato do dono: *"não consigo selecionar parte do
  texto… quando clico em copiar, copia o texto completo"*) — a cliente manda
  o pedido inteiro e a loja quer só o endereço, ou só a chave Pix. Eram
  DOIS problemas: o botão ignorava a marcação (mandava sempre a mensagem
  inteira, `textoParaCopiar`/`selecaoDentroDe`) e **no celular não havia
  como marcar** — o toque longo abre o nosso menu em 450 ms e o arrasto
  responde a mensagem, comendo justamente o gesto que o aparelho usa para
  marcar texto. Agora o menu tem **"Selecionar texto"** (só no celular; no
  computador é só arrastar o mouse): aquela bolha entra em modo de marcar
  (gestos fora do caminho, `select-text`, anel amarelo) e uma barra própria
  no rodapé oferece **Copiar trecho / Cancelar** — sem ela o dedo marcaria
  o trecho e não haveria onde tocar, porque o menu já fechou. A barra é
  elemento SOLTO de propósito: a ordem das barras do compositor é regra
  (incidente 28/08/2026) e nada aqui encosta nela. A marcação é lida no
  **pressionar** do botão, não no clique (nos DOIS botões) — encostar nele
  tira o foco do texto e o navegador desfaz a marcação antes de o clique
  chegar, e o trecho voltava a ser a mensagem inteira, que é justamente o
  defeito relatado. **As DUAS pontas da marcação têm que estar dentro da
  bolha**: olhando só a âncora, a marcação feita de baixo para cima era
  recusada e a que escorrega para fora era aceita levando o texto da
  mensagem vizinha — e o que sai daqui vai para o WhatsApp da cliente.
  Escorregou, vale a mensagem inteira (falha segura). Abrir o menu de
  qualquer mensagem **sai do modo**: a folha de ações sobe de baixo no
  celular e a barra cobriria os últimos itens dela; com os dois ligados, a
  âncora da marcação era uma bolha e o texto copiado era de outra (achados
  da revisão). O aviso do rodapé diz o que FOI
  para a área de transferência ("Trecho copiado" / "Mensagem copiada"):
  sem ele a vendedora cola sem saber o que tem na mão. Trocar de conversa
  sai do modo (a bolha marcada nem está mais na tela, e a barra esconderia
  o compositor da conversa nova). **Com texto marcado, o CLIQUE DIREITO é
  do NAVEGADOR** (`menuDoNavegador`, segundo relato do dono no mesmo dia:
  *"quando clico com botão direito abre essas opções, e não aquela
  tradicional de copiar"*): marcar um pedaço e apertar o botão direito é o
  gesto que todo mundo já tem nos dedos, e sequestrá-lo obrigava a
  vendedora a aprender o nosso menu no lugar do que ela conhece. A folha
  de ações é o menu da MENSAGEM (responder, encaminhar, reagir, apagar) e
  continua abrindo no clique direito da bolha SEM marcação; marcação em
  outra bolha não tira o nosso menu daqui, e clicar sem arrastar também
  não (senão a bolha ficaria sem menu nenhum),
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
  (~2 dias), detecção de "cliente apagou" (conteúdo preservado),
  **mensagem editada pela cliente** (`lib/comm/edicao.ts`, 17/09/2026,
  print do dono: a cliente acrescentou duas cores ao pedido editando a
  mensagem e a Central seguiu com o texto velho, sem "editada"): o servidor
  Evolution v2 NÃO entrega a edição pelo `MESSAGES_UPSERT` — reconhece antes,
  manda SÓ o evento **`MESSAGES_EDITED`** (o `protocolMessage` solto, com a
  chave da mensagem ORIGINAL e o texto novo) e pula o resto. O evento entrou
  na assinatura (`WEBHOOK_EVENTS`) e o webhook o embrulha no formato do laço
  do upsert (`mensagensDoEventoEditado`) — daí vale tudo que a edição já
  tinha: corrige pelo alvo, carimba `editedAt` (a bolha diz "editada"), toca
  a conversa para o sync de 3s entregar, busca o texto no servidor se vier
  cifrado, e original desconhecida vira bolha com o texto novo. **A loja já
  conectada é reassinada SOZINHA** (`lib/comm/garantir-webhook.ts`): a lista
  de eventos fica gravada na instância no dia da conexão, e a única auto-cura
  rodava ao abrir a tela de conexão, que a loja conectada não abre nunca
  mais. O carimbo `CommSettings.evolutionWebhookEventos` guarda a lista que o
  servidor CONFIRMOU; diferente da atual, reassina de carona (no webhook,
  depois da resposta; no vigia; na tela de conexão) e carimba — uma vez por
  loja, com freio de 10 min após falha; nunca um 3º cron (ADR-002). **Recusa
  do servidor NÃO fica calada**: vai para a Central de Comunicação
  (`wa.webhook.assinatura-recusada`, com a resposta crua) e a tela de conexão
  diz se os avisos estão em dia e a **versão do servidor** (`evoVersao`) — o
  evento de edição só existe a partir da Evolution 2.2, e sem a versão na
  tela a investigação vira chute, mensagens
  automáticas personalizáveis (link do catálogo e confirmação de pedido, em
  `CommSettings`), unificação de contatos duplicados, importação de
  histórico de 30 dias (depende do servidor Evolution guardar histórico),
  **foto de perfil das clientes** (`lib/comm/fotos.ts`: guarda só o LINK do
  WhatsApp — nunca a imagem —, revalida a cada 7 dias, busca em lote com teto
  por rodada e cai nas iniciais coloridas quando a cliente esconde a foto ou
  o link vence).
- **RN-079 · HORÁRIO DE ATENDIMENTO DA LOJA: O TEMPO DE RESPOSTA CONTA SÓ
  COM A PORTA ABERTA** (`lib/bi/horario-comercial.ts`, card "Horário de
  atendimento" em Configurações, 13/10/2026): primeira peça do **BI de
  vendas do WhatsApp** (ADR-019), desenhado com o dono para as lojas que
  contratam a assessoria de processo comercial. A cliente que escreve às
  22h e recebe resposta às 8h05 esperou **5 minutos de atendimento**, não
  10 horas — medir pelo relógio de parede faria a vendedora que respondeu
  ao chegar aparecer como a mais lenta da equipe. Decidido: (1) o horário é
  **da loja**, por dia da semana, com até **dois períodos** (manhã e tarde:
  a pausa de almoço da confecção é real), gravado como JSON em
  `Company.horarioComercial` e conferido na porta pela MESMA régua que a
  leitura usa (`validarHorarioComercial`: hora que não existe, fim antes do
  início, períodos sobrepostos e loja que nunca abre são recusados com a
  frase dizendo QUAL dia); (2) **sem horário cadastrado conta o dia
  inteiro**, madrugada inclusa (`null` = "não sei quando abre"; inventar um
  horário mentiria para o lado bom) — a tela diz isso e oferece o padrão
  seg–sex 8h–18h, sáb 8h–12h com um clique; leitura torta vira `null`,
  nunca derruba tela nem conta; (3) **o PRAZO de resposta é o que a loja já
  tinha**, `Company.intakeSlaMinutes` ("SLA do 1º atendimento", Entrada de
  leads) — um segundo campo com o mesmo significado é onde dois números um
  dia discordam; o prazo passa a valer em **minutos de atendimento**
  (`respondeuNoPrazo`: prazo de 30 min, cliente das 22h, resposta até 8h30
  do dia seguinte está no prazo) — e **a tarefa de primeiro atendimento
  (RN-008) vence pela mesma régua** (`prazoNoHorario`: o lead das 22h vence
  às 8h30, não às 22h30; antes a tarefa amanhecia atrasada para quem nem
  tinha chegado, enquanto a conta dizia "no prazo" — achado da revisão);
  (5) a **recuperação automática** de sacola passa a respeitar o horário da
  loja (`podeMandarAutomatica`: a loja que fecha sábado não manda sábado à
  tarde; sem cadastro segue o 8h–20h de sempre); (6) a conta (`minutosDeAtendimentoEntre`)
  soma só a sobreposição do intervalo com os períodos abertos, dia a dia,
  no **relógio de São Paulo** (UTC−3, a régua de `diaSP` e do Financeiro) —
  limite dito: loja fora desse fuso cadastra o horário em hora de Brasília;
  fim antes do início é zero; "24:00" é o fim do dia (a tela o mostra como
  23:59, porque o campo de hora do navegador não desenha 24:00). Gerência
  grava, toda a equipe vê. Entrega de
  INSTRUMENTAÇÃO: nada mostra ainda — a tela do BI vem na Fase 1, sobre
  dados que já estarão sendo contados certos (coleta para todas as lojas,
  tela só para quem tem a chave, ADR-019).
- **RN-080 · MENSAGEM DE ROBÔ NUNCA É RESPOSTA — E A ESPERA DA CLIENTE É
  PAREADA COM A PRIMEIRA RESPOSTA HUMANA** (`Message.automatica` +
  `lib/bi/tempo-de-resposta.ts`, 13/10/2026): segunda peça do BI (ADR-019).
  O tempo de resposta mede "quanto a cliente esperou por uma PESSOA", então
  (1) todo envio que ninguém digitou leva a marca `automatica` — e **no
  motor a mensagem SEM `authorId` é de robô por padrão** (`input.automatica
  ?? !input.authorId`): toda porta humana assina (tela, cobrança, rastreio,
  encaminhar), só a recuperação automática não, e a porta automática nova
  que esquecer a marca cai do lado certo (opt-in era o "esqueceu um" da
  RN-059, achado da revisão); o eco da mensagem mandada pelo celular da
  loja não passa pelo motor (nasce no webhook, sem autor, e É humana);
  **o robô não é "primeiro contato"**: não avança o funil, e o eco dele não
  conclui a tarefa de primeiro atendimento (ninguém falou com a cliente) —
  e o eco do robô tem janela de adoção de um dia (o envio cadenciado pode
  ficar ENVIANDO além dos 10 min; perdido, renascia como humano); (2) a
  ESPERA começa na primeira mensagem de texto da cliente sem resposta (as
  seguintes não zeram o cronômetro — a cliente manda cinco de uma vez) e
  fecha na primeira mensagem HUMANA da loja depois dela: texto, não nota
  interna, não robô (`respostaHumana`); respondida, a próxima mensagem da
  cliente abre espera nova; abordagem da loja sem pergunta não vira espera;
  (3) os minutos são DE ATENDIMENTO (RN-079) e o prazo é o
  `intakeSlaMinutes`: a espera aberta conta até agora e diz se o prazo **já
  estourou** (`noPrazo: false`, o que o painel vai gritar) ou se ainda dá
  tempo (`null` — não decide); a espera aberta numa conversa que a loja
  **ENCERROU** (o "obrigada!" do fim) não é cliente esperando
  (`encerradas`, conta à parte) — sem isso cada venda fechada virava espera
  eterna fora do prazo; (4) o resumo (`resumirEsperas`) traz respondidas,
  sem resposta, encerradas sem resposta, no prazo, fora do prazo, % no
  prazo (só das decididas), mediana, média e p90 — e **sem espera nenhuma
  os números são nulos**, nunca zero disfarçado de "ótimo". **A régua "que
  mensagem conta" é escrita UMA vez** (`ONDE_MENSAGEM_CONTA`, texto e não
  robô): o BI a usa em memória e o monitor da IA de Vendas (`lib/ia.ts`) a
  espalha no `where`, com teste de que concordam em toda combinação; o
  monitor segue com a régua dele no resto (relógio de parede, teto de 24h,
  atribuição à dona da conversa — é termômetro de equipe). **Limites
  ditos**: o histórico anterior à marca conta a recuperação automática
  antiga como resposta humana — só o que nasce daqui em diante é exato; e
  o robô ainda carimba `lastOutboundAt` (a aba Fila da Central o trata como
  "a loja falou"), decisão de tela que fica para a Fase 1. Entrega de INSTRUMENTAÇÃO: a conta existe
  e está provada; a tela que a mostra vem na Fase 1.
- **RN-081 · MOTIVO DE PERDA É LISTA FECHADA, GRAVADO COMO "CHIP — DETALHE"**
  (`lib/funil/motivos-de-perda.ts`, 13/10/2026): terceira peça do BI
  (ADR-019). "Por que não fechou?" é a pergunta número um de quem organiza
  processo comercial, e só serve se der para CONTAR. O funil já perguntava
  numa lista (o `window.prompt` não abria no celular; texto livre virava
  "preço", "Preço" e "achou caro" em três barras), mas a lista morava
  dentro da tela, **a porta aceitava qualquer texto** e o relatório agrupava
  por texto normalizado. Agora: (1) a lista é **fonte única na lib**
  (`MOTIVOS_DE_PERDA`: achou caro, não fechou o mínimo, prazo, frete, não
  tinha a grade, comprou de outro, sumiu, só pesquisando, outro) e a tela a
  importa — teste derruba a cópia; (2) o texto gravado segue o padrão das
  trocas (RN-073): **"Chip — detalhe"** (`textoDoMotivoDePerda`), o "Outro"
  da tela leva o que a vendedora escreveu como detalhe; (3) **a porta recusa
  motivo fora da lista** (`validarMotivoDePerda`, 400 com frase; detalhe até
  120 letras) — o sistema também grava motivo próprio ("Pedido cancelado",
  `MOTIVOS_DO_SISTEMA`, chip à parte, e o teste prende a sincronização a
  ele); (4) **quem conta, conta pelo CHIP** (`contarPorMotivo`, Relatórios
  hoje, o BI amanhã): texto antigo que só difere em caixa, acento ou
  espaço cai no chip certo (`chaveDoMotivo`, só na LEITURA — a porta exige
  o chip como está escrito), frase livre cai em "Outro" em vez de virar uma
  barra por frase, a barra "Outro" lista embaixo os detalhes mais repetidos
  ("pediu boleto ×12" — uma barra por chip sem perder o que foi escrito), e
  "Sem motivo registrado" fica por último. A porta grava a forma CANÔNICA
  (`lerMotivoDePerda`: espaços arrumados, travessão único) e o teto do
  detalhe é um só para tela e porta (`TETO_DO_DETALHE`). Nada é migrado: o
  que já está gravado continua legível e só o que nasce daqui em diante é
  exato.
- **RN-082 · BI DE VENDAS: FATOS DIÁRIOS PRONTOS, PAINEL DO DONO, CHAVE SÓ
  NA TELA** (`lib/bi/fatos.ts` + `lib/bi/painel.ts` + `lib/bi/metas.ts`,
  porteira `lib/bi/gate.ts`, tela `/bi`, 14/10/2026): a Fase 1 do BI
  (ADR-019). **Módulo com chave** (`Company.biEnabled`, Super Admin liga por
  loja no painel Lojas, catálogo `BI` com preço de tabela 0 até o dono
  definir) e **só gerência** vê (decisão do dono) — a aba "BI de Vendas"
  nem aparece sem os dois. **Os números nascem em `BiDia`**, uma linha por
  loja × dia (calendário de SP): contatos novos e por origem, quantos
  tiveram resposta humana, as esperas da cliente que COMEÇARAM no dia e
  como terminaram (respondida no prazo / fora / sem resposta / encerrada),
  mediana e p90 em minutos de atendimento (RN-079/RN-080), a distribuição
  em 7 baldes (até 5, 15, 30, 60, 120, 240 min e acima — **mediana de
  medianas não é mediana**; o período soma baldes), pedidos criados (fora
  cancelados), pedidos pagos e valor vendido (RN-001/RN-002). **De carona**
  no sync da inbox e na abertura do painel, com trava de 30 min por loja
  (`biFatosRunAt`, freio em memória antes do banco, a régua da RN-051),
  **para TODA loja** — a chave abre a tela, a coleta é de todas (o motor
  nunca filtra por `biEnabled`, e o teste prende isso). **Janela**: hoje e
  os 7 dias anteriores são REFEITOS a cada rodada (a espera de ontem é
  respondida hoje; o lead de anteontem vira resposta amanhã) e o passado é
  congelado; dias que faltam nos últimos 90 entram 22 por rodada — a loja
  que contratar o BI daqui a três meses encontra três meses de história.
  A leitura começa **7 dias ANTES do primeiro dia calculado** (a espera que
  começou num dia congelado não renasce pela mensagem seguinte da cliente, e
  a resposta de hoje à pergunta de ontem vê a pergunta), lê as mensagens
  **mais novas primeiro** com teto de 60 mil e, se o teto cortar, grava só
  os dias com janela completa (`diasComJanelaCompleta`) e anota na Saúde
  sem alarme; a gravação é uma transação; a rodada que falha **mantém a
  trava** (o sync de 3s não repete a consulta mais pesada do app) e vai para
  a Saúde sem alarme — achados da revisão. A abertura do painel roda só os
  dias vivos (`soVivos`); o histórico é da carona. **A conta é pura** (`calcularFatos`) e a espera conta no dia da
  CHEGADA da cliente, nunca duas vezes. **O painel** (`montarPainel`) soma
  as linhas do período e do período anterior e junta três números vivos
  baratos: quem está esperando AGORA (UMA contagem em SQL: última fala é da
  cliente, conversa não encerrada), vendas do mês (pedidos pagos, `netTotal`)
  e recompra (clientes com 2+ compras pagas, a régua do Dashboard). O
  período tem teto de um ano (`encaixarPeriodo`, o mesmo recorte para somas
  e séries) e o dia da URL é conferido pela régua de `lib/dia.ts`
  (`dataDoDia`; "2026-02-30" não vira 2 de março). `mesSP` e
  `inicioDoMesSP` passaram a morar em `lib/dia.ts` (um relógio só; `ia.ts`
  e `recompra-painel.ts` reexportam). Mostra
  a faixa "Hoje", os seis números (novos contatos, % respondidos no prazo,
  sem resposta, vendido, ticket, recompra — com a comparação do período
  anterior), **metas do mês** (cardápio fechado em `TIPOS_DE_META`:
  faturamento, pedidos pagos, novos contatos, % no prazo, ticket, recompra;
  a loja preenche as que quiser, mês a mês, `BiMeta`; realizado × meta em
  barra), **funil por fatos** (contatos novos do período → respondidos por
  pessoa → fizeram pedido → pagaram, as quatro barras da MESMA fonte, os
  fatos — `leadsComPedido`/`leadsPagaram` —, com horizonte de 7 dias depois
  do cadastro; nada de etapa arrastada), contatos e
  vendido por dia, a distribuição do tempo de resposta, de onde vieram e
  por que não fechou (RN-081). Avisa quando a loja não tem horário
  cadastrado (a conta está contando a madrugada) e quantos dias do período
  ainda não têm fato. Provado contra o Postgres local
  (`scripts/e2e-bi.ts`: dois dias, robô no meio, conversa encerrada, pedido
  pago no dia seguinte, cancelado fora, trava da carona). **Limites ditos**:
  o funil tem horizonte de 7 dias (o lead que responde, pede ou paga depois
  disso fica fora, porque o dia congelou); "esperando agora" lê
  `lastOutboundAt`, que o robô ainda carimba (RN-080); a origem só diz o
  canal (qual anúncio, só com link rastreado); loja fora do fuso de SP conta
  o dia em hora de Brasília.
- **RN-083 · BI POR VENDEDORA: A MESMA CONTA DA LOJA, RECORTADA POR QUEM
  FEZ** (`calcularFatosPorVendedora` em `lib/bi/fatos.ts` + `BiDiaVendedora`
  + `montarVendedoras` em `lib/bi/painel.ts`, aba **Vendedoras** em `/bi`,
  14/10/2026): a Fase 2a do BI (ADR-019). A pergunta de quem organiza o
  processo comercial é "quem responde rápido, quem deixa cliente sem
  resposta, quem converte, quem vende" — e a resposta tem que vir dos
  MESMOS fatos do painel, não de uma segunda conta. Então a rodada de carona
  (RN-082) grava, na MESMA transação, uma linha por loja × dia × pessoa, e
  cada número tem UM dono, dito: (1) a **espera respondida é de quem
  RESPONDEU** (`Espera.autoraId`, o `authorId` da mensagem) — a Ana que
  responde a conversa da Bia leva a resposta, porque foi ela quem atendeu;
  o eco do celular da loja não tem autora e fica só no total — e **o "no
  prazo" da pessoa é só das que ELA respondeu** (achado da revisão: contar a
  fila parada enquanto ela está de folga como "fora do prazo" dela diria que
  ela responde atrasado; a loja segue contando a aberta estourada como fora
  do prazo, RN-082, que é a pergunta da loja, e a tabela diz por que os dois
  números diferem); (2) a **espera sem resposta é de quem ASSUMIU a
  conversa** (`Conversation.assigneeId`), só como "sem resposta"; na fila, é
  de ninguém — fica no total, e a aba diz; (3) o **contato novo é
  da dona da CARTEIRA** (`Customer.ownerId`), com o funil dele (respondido
  por alguém, fez pedido, pagou — a régua de 7 dias do painel), o que dá a
  **conversão por vendedora** (pagaram ÷ leads da carteira); (4) o **pedido
  é da vendedora dele** (`Order.sellerId`, RN-005): criados fora cancelado,
  pagos pela data do pagamento, `netTotal` (RN-002) — a loja online não tem
  dona e fica só no total. **Só gente DA LOJA vira linha** (RN-013: a lista
  de `User` da loja é a peneira; o Super Admin acessando como loja responde
  e vende, e isso fica no total, nunca numa linha de pessoa), e **só quem
  teve algum número no dia**. **A linha é DERIVADA, apagada e refeita** nos
  dias da rodada (`deleteMany` + `createMany`, nunca upsert): o pedido
  cancelado hoje tira a venda de ontem da pessoa — provado contra o
  Postgres local —, e um upsert deixaria a linha velha de pé. **A soma das
  pessoas nunca passa do total da loja, e a diferença é "Sem vendedora"**
  (celular da loja, lead da loja, loja online, fila), uma linha cinza na
  tabela em vez de um número que não bate com o painel. **O histórico
  gravado ANTES desta aba ganha as pessoas sozinho**: cada `BiDia` leva a
  `versao` da conta que a gravou (`VERSAO_DOS_FATOS`), a rodada só conta
  como "já gravado" o dia da versão atual, e a linha velha é refeita de
  carona, 22 por rodada, com as duas tabelas — sem isso os 82 dias
  congelados da Fase 1 ficariam para sempre com o total da loja e zero por
  pessoa, caindo todos em "Sem vendedora" (achado da revisão); enquanto
  isso, a aba DIZ quantos dias do período ainda não têm a conta por pessoa
  (`diasSemVendedoras`). A aba mostra o
  ranking por vendido (empate pelo que respondeu), com no prazo, sem
  resposta e conversão por pessoa, a tabela completa com a linha da loja, e
  a pessoa desativada aparece marcada enquanto tiver número no período (a
  história não some com o desligamento). As abas levam o período junto e os
  atalhos de período levam a aba (`extra`). **Limites ditos**: a dona da
  conversa e da carteira são as de HOJE (a conversa transferida depois de o
  dia congelar fica com quem a tinha ao congelar; a carteira transferida
  move os leads nos dias ainda vivos); o eco do celular da loja não tem
  dona por definição; e, como no painel, só o que nasceu depois da marca de
  robô (RN-080) é exato. Provado contra o Postgres local
  (`scripts/e2e-bi.ts`, bloco 4: duas vendedoras, loja online sem dona, a
  resposta no dia da chegada, o cancelamento que tira a venda da pessoa).
- **RN-084 · A ABA CLIENTES DO BI É A CARTEIRA DA RECOMPRA, LIDA EM R × F ×
  M** (`lib/bi/carteira.ts`, aba **Clientes** em `/bi`, 14/10/2026): a
  Fase 2b do BI (ADR-019). O dono pediu "recompras, melhores clientes"; a
  casa JÁ tinha a carteira inteira na aba Recompra (`dadosDaAbaRecompra`:
  faixa pela última compra — ativa < 30 dias, esfriando < 60, em risco <
  90, sumida —, o ritmo de cada cliente, o Top 20 VIP) e o painel de
  Recompra com a regra de ouro "este painel não faz conta própria". A
  régua vale aqui: **a aba lê a carteira da fonte única e NUNCA decide
  faixa, ritmo ou VIP por conta própria** (o teste proíbe `faixaFixa`,
  `passouDoRitmo`, `cicloEntreCompras` e `TOP_VIPS` no arquivo) — se o BI
  dissesse "40 ativas" e a Recompra "38", a loja pararia de confiar nas
  duas. **O que o BI acrescenta** é a leitura cruzada: (1) a matriz R × F
  (faixa × quantas compras na vida) — **substituída em 23/10/2026 pelo
  RFM de verdade (RN-093)**, que ocupa o topo da aba; (2) **as VIPs que
  esfriaram** (Top 20 fora da faixa Ativa, pela posição) — o alarme de
  verdade da carteira, com link para a ficha (a mensagem pronta mora na
  Recompra); (3) os números da carteira pela MESMA conta do painel de
  Recompra (recompra = 2+ compras ÷ compradoras, quem passou do próprio
  ritmo, o valor na mesa = uma compra média de cada atrasada, a
  concentração do Top 20 no total histórico); (4) **as melhores clientes
  DO PERÍODO** — a única parte que olha o período da tela: pedidos pagos
  pela data do pagamento, `netTotal` (RN-001/RN-002), Top 20 por `groupBy`
  no banco, nome recortado pela loja (RN-013), com a faixa de HOJE e o selo
  VIP ao lado. **Quatro achados da revisão**: a carteira é lida na forma
  **LEVE** (`dadosDaAbaRecompra(user, { leve: true })` — a mesma régua e a
  mesma lista, sem os itens de cada pedido nem as novidades, que só a aba
  Recompra mostra); o nome das melhores vem da carteira (quem pagou no
  período está nela), sem quarta ida ao banco; **a recompra do painel do BI
  passou a seguir a régua da carteira** — pedido pago COM data de pagamento
  — para as duas abas dizerem o mesmo número (o Dashboard ainda conta o
  pago sem data, que é só o pedido antigo; limite dito).
  **Limites ditos**: as faixas são fixas (30/60/90 dias, decisão antiga da
  Recompra), não por loja; a legenda não repete o número — diz "fora da
  faixa Ativa".
- **RN-085 · ROI DE ANÚNCIO: GASTO POR MÊS, E AS DUAS PONTAS NA RÉGUA DO
  PERÍODO** (`lib/bi/anuncios.ts` + `BiGastoDeAnuncio` + rota
  `/api/bi/anuncios/gastos`, aba **Anúncios** em `/bi`, 14/10/2026): a
  Fase 2c do BI (ADR-019), fechando a Fase 2. O dono pediu "de qual
  anúncio ele vem" e aceitou "gasto de anúncio pode ser colocado". A
  atribuição já era automática e assim fica (RN-015: o link do anúncio
  Click-to-WhatsApp vira `Customer.campaignId` numa `MarketingCampaign`;
  sem marcação manual, decisão do dono). O que faltava era o **gasto POR
  MÊS**: a tela Marketing guarda o investimento de TODA A VIDA e compara
  com o faturamento de toda a vida — conta verdadeira, mas que não
  responde "outubro valeu a pena?". Agora a gerência informa, na própria
  aba, quanto gastou em cada campanha em cada mês (`BiGastoDeAnuncio`,
  único por loja × campanha × mês; em branco ou zero apaga; a rota confere
  que a campanha é DA LOJA, RN-013), e a aba compara, **no período da
  tela**: (1) **gasto** = soma dos meses INTEIROS que o período toca (o
  período de 1 a 15 usa o mês inteiro — ratear por dia seria precisão de
  mentira, a loja não gasta igual todo dia; a tela diz); (2) **contatos
  novos** = a coorte, clientes cadastradas no período com a campanha
  atribuída, e **pagaram** = quantas dessas já têm pedido pago, em
  qualquer data (a cliente que chegou dia 28 e pagou dia 3 conta para o
  anúncio que a trouxe); (3) **vendido** = caixa, o que entrou no período
  de QUALQUER cliente da campanha (pedido pago pela data do pagamento,
  `netTotal`, RN-001/RN-002) — o anúncio de março que ainda traz recompra
  aparece em outubro, e a tela diz que coorte e caixa são duas perguntas.
  Daí **CAC** = gasto ÷ contatos, **custo por venda** = gasto ÷ pagaram,
  **retorno** = vendido ÷ gasto (em "×", verde a partir de 1), **conversão**
  = pagaram ÷ contatos; **sem base, nulo** — nunca zero disfarçado
  (`calcularRetorno`). Só campanha com algum número vira linha, a parada
  com número aparece marcada, o total refaz as contas sobre a SOMA (não é
  média das linhas), e a aba diz quantos contatos novos do período chegaram
  **sem anúncio identificado**. **Cinco achados da revisão fecharam a
  entrega**: o editor manda **só as células que mudaram, com o valor
  VISTO** (régua da RN-050 — a grade inteira apagava o mês que outra aba
  ou outra gerente tinha gravado, e o estado preso ao primeiro período
  fazia o salvar apagar o mês do período seguinte; o editor remonta por
  período, `key` pelos meses) e a rota recusa com 409 quando o número
  mudou por baixo; **centavos** na rota e valor escrito em pt-BR no campo
  ("12,345" gravado cru voltava como "12.345" e virava 12 mil); a leitura
  é **toda recortada pelo período** (a coorte, e o caixa agregado no
  banco, uma linha por cliente que pagou — nunca a vida inteira das
  clientes); a lista de canais mora em `lib/canais-de-anuncio.ts`, uma
  para o formulário da campanha e o BI; e o teste prende a régua das
  consultas com banco simulado, não com regex do texto. **Limites ditos**: o "retorno por R$ 1" da
  tela Marketing é OUTRA conta (toda a vida ÷ investimento total) e a tela
  diz — dois lugares para digitar gasto é um risco aceito até o dono
  decidir se o total vira a soma dos meses; os links de campanha da
  Inteligência (`TrackCampaign`, cliques e meta) não entram aqui — são
  links do catálogo, não anúncios pagos.
- **RN-086 · CLICAR E CAVAR: TODO NÚMERO DO BI ABRE A LISTA DE QUEM ESTÁ
  POR TRÁS DELE** (`lib/bi/listas.ts` + página `/bi/lista`, 14/10/2026): a
  primeira das cinco recomendações que o dono aceitou para o BI virar
  "completo e dinâmico" (as outras: linha de 12 meses, faixa "hoje" viva,
  visual, exportar PDF). "12 sem resposta" não serve para nada se o dono não
  consegue ver QUEM são as doze — é a diferença entre relatório e BI. Então
  os números viram link: no Painel (esperando agora, novos contatos, sem
  resposta, vendido), em Vendedoras (contatos, sem resposta e vendido de
  cada pessoa e da loja), em Anúncios (contatos e vendas de cada campanha) e
  em Clientes (cada grupo e cada célula da matriz do RFM, RN-093). **A régua da lista
  é a MESMA do número que a abriu**, escrita uma vez em `montarLista`:
  esperando agora pela SQL do painel (RN-082), **desde a PRIMEIRA mensagem
  sem resposta** (RN-080 — pela última, a cliente que insiste "oi?" parecia
  recém-chegada; achado da revisão) e vermelho pelo prazo da loja; sem
  resposta pelo motor das esperas (`parearEsperas`, RN-080) **lendo só as
  conversas que estão esperando agora** (a espera ainda aberta mora numa
  delas — ler a loja inteira era a consulta mais pesada do app a cada
  clique, achado da revisão; em lotes de ids, com teto de conversas dito),
  por vendedora as das conversas que ela assumiu (RN-083); contatos por cadastro no período, por carteira ou por campanha
  de anúncio (RN-085); vendas por pagamento no período, `netTotal`
  (RN-001/RN-002), por vendedora (RN-005) ou por cliente da campanha;
  RFM pela MESMA conta da aba (RN-093), com o botão de chamar. Toda lista é recortada
  pela loja (RN-013), tem teto (`TETO_DA_LISTA`, 300) e diz quantas havia;
  cada linha leva ao caminho de sempre — a conversa (`/whatsapp?conv=`, a
  única forma de link para a Central, régua do teste de agenda), a ficha da
  cliente ou a ficha do pedido — e o "voltar" devolve à aba e ao período de
  onde a pessoa veio. O endereço é montado por `hrefDaLista` e lido por
  `lerFiltro` (tipo fora da lista, dia que não existe, faixa torta ou
  parâmetro repetido na URL recusam a lista inteira, nunca mostram a loja
  disfarçada de resultado); a lista das abas mora em `lib/bi/abas.ts`, uma
  para a tela e as listas. Só gerência, pela porteira do BI. **Limite dito
  NA TELA**: o número do BI vem dos fatos do dia (o passado congela,
  RN-082) e a lista é de AGORA — a espera respondida depois de o dia
  congelar, o pedido cancelado hoje, estão no número e não na lista; a
  página escreve isso embaixo do total.
- **RN-087 · A LINHA DE 12 MESES: DUAS FONTES, UMA RÉGUA** (`lib/bi/tendencia.ts`
  + cartão "Últimos 12 meses" no Painel do BI, 14/10/2026): a segunda
  recomendação aceita pelo dono — tendência mês a mês, não só "este período
  contra o anterior". Os fatos diários cobrem 90 dias (RN-082) e esticá-los
  para um ano faria cada rodada ler o ano inteiro de mensagens; então
  **contatos e vendas por mês saem direto das tabelas de origem**, pela
  MESMA régua dos fatos — cliente cadastrada no mês (calendário de SP: no
  SQL é `carimbo − 3 horas`, a conta exata do `diaSP`; o `AT TIME ZONE` numa
  coluna sem fuso converte no sentido ERRADO e jogava o cadastro das 22h do
  dia 30 no mês seguinte, achado da revisão, provado na virada do mês contra
  o Postgres local) e pedido pago pela data do pagamento, `netTotal`
  (RN-001/RN-002) —, agregados no banco numa linha por mês; e **o
  atendimento (% no prazo, sem resposta) só onde há fato**: o mês soma os
  `BiDia` que tem, mostra "—" sem fato (nunca zero disfarçado), diz
  "atendimento em N de M dias" quando o mês veio pela metade, e a legenda
  diz a partir de que mês o tempo de resposta é contado. O cartão fica fora
  do filtro de período (é a tendência da loja). Ticket = vendido ÷ pedidos
  pagos do mês. **Limite dito**: o mês corrente conta até hoje.
- **RN-088 · A FAIXA "HOJE" É AO VIVO E SE ATUALIZA SOZINHA** (`lib/bi/hoje.ts`
  + rota `/api/bi/hoje` + `faixa-de-hoje.tsx`, 14/10/2026): a terceira
  recomendação aceita pelo dono. Os quatro números de hoje (contatos novos,
  esperando agora, pedidos pagos, vendido) deixam de vir do fato do dia
  (refeito a cada 30 min pela carona) e passam a ser **calculados na hora**,
  por três consultas pequenas (o índice `Customer(companyId, createdAt)`
  nasceu aqui, migração 20261014190000 — a conta de "contatos de hoje"
  varria a loja; e o painel deixou de repetir a consulta do "esperando
  agora", que agora tem UM lugar), pelas réguas de sempre —
  cliente cadastrada hoje (0h de SP), pedido pago hoje pela data do
  pagamento com `netTotal` (RN-001/RN-002), a cláusula do "esperando agora"
  (RN-082). A tela **pede de novo a cada 30 s enquanto a aba está visível**
  (escondida, para — ninguém olha, e cada pedido é banco; ao voltar para a
  aba pede na hora), mostra "ao vivo · atualizado há N s" (o relógio é
  componente próprio: só ele redesenha a cada segundo, e o leitor de tela
  anuncia só a falha, não os segundos), e se um pedido falhar **mantém o
  último número bom** e diz O QUE foi — 401 "sua sessão venceu, entre em
  outra aba" (RN-064), 403/404 "o BI não está mais disponível", o resto
  "sem conexão" — nunca pisca zero. A parte pura mora em `hoje-regra.ts`
  (o navegador não pode importar o motor com Prisma; o guarda
  `navegador-sem-servidor` derruba). Provado com a tela de verdade em
  jsdom (`faixa-de-hoje.test.tsx`: escondida não pede, ao voltar pede,
  401 mantém o número e diz). A rota passa pela porteira do BI (gerência,
  com a chave). O rodapé
  continua dizendo quando os fatos do PERÍODO foram atualizados — são dois
  relógios, e a faixa diz qual é o dela. **Limite dito**: "esperando agora"
  segue lendo `lastOutboundAt`, que o robô ainda carimba (RN-080).
- **RN-089 · OS GRÁFICOS DO BI SÃO VIVOS, E A COR É VALIDADA — NUNCA A OLHO**
  (`lib/bi/paleta.ts` + `components/grafico-vivo.tsx`, 14/10/2026): a quarta
  recomendação aceita pelo dono ("magnético"). Pela disciplina de
  visualização da casa (skill dataviz), em três decisões: (1) **a camada de
  interação faz parte do gráfico**: na série de tempo a MIRA acha a data pela
  posição do dedo (ninguém precisa acertar uma linha de 2 px), o balão mostra
  o valor, o teclado anda pelos pontos (setas, Esc), e o rótulo direto é só
  no pico e no último ponto — número em todo ponto vira barulho; o funil diz
  a **conversão de cada etapa** (% da anterior; ao passar, % do começo); as
  barras têm o valor na ponta e escurecem as vizinhas ao passar; a entrada é
  animada (linha que se desenha, barra que cresce), e a regra global de
  "reduzir movimento" zera tudo; (2) **a cor faz um trabalho só por
  gráfico**: série de tempo = UMA cor (o cobre da marca, 4,03:1 sobre a
  superfície dos cartões; série única não tem legenda, o título diz o que
  é); funil = rampa ORDINAL de um matiz em 4 degraus, clara → escura; barras
  de categoria = a mesma cor em todas (colorir por valor gastaria a cor para
  repetir o que o comprimento já diz); **vermelho, âmbar e verde são
  STATUS** (prazo, sem resposta) e nunca cor de série — "por que não fechou"
  deixou de ser vermelho, "quanto esperou" deixou de ser verde-água; (3)
  **a paleta é VALIDADA pelo validador da disciplina, não a olho**: a rampa
  ordinal antiga começava num ocre a 1,81:1 sobre a superfície (reprovado —
  abaixo do piso de 2:1), então o funil do BI começa no ocre médio (2,48:1);
  o teste guarda o contraste e a monotonia por conta própria, para a
  regra não depender de rodar o validador. Os números da faixa "hoje"
  **animam ao mudar** (a contagem do Dashboard, `useContagem`, com
  `tabular-nums` para o dígito não balançar a linha). **Achados da revisão
  fecharam a entrega**: (a) **função não atravessa a fronteira servidor →
  navegador** — a página do BI é componente de servidor e os gráficos são
  do navegador; passar `formatValue={(v) => …}` quebrava a página inteira
  em tempo de execução, e nem o build nem o teste do componente pegam; o
  formato é um valor serializável (`FormatoDoValor`: "int", "brl" ou
  `{ pctDe }`); (b) **o estado final vem do servidor**: a primeira versão
  nascia invisível (linha dashada, barra a 0%) até o JavaScript montar — no
  4G fraco da RN-070 o dono veria cartões vazios; a entrada passou a ser
  transição CSS a partir de `@starting-style` (navegador antigo ignora e vê
  o gráfico pronto), e "reduzir movimento" zera também o atraso escalonado
  (`animation-delay`); (c) **toque no celular**: a seleção por dedo FICA
  até o próximo toque (por mouse, sai ao sair) — antes o balão sumia ao
  levantar o dedo; (d) o balão é anunciado pelo leitor de tela (`group` +
  `aria-roledescription`, `aria-live` fora do SVG decorativo — dentro de
  `role="img"` o `status` era descartado); (e) o rótulo do último ponto sai
  quando colide com o do pico; série vazia diz "sem dados" em vez de quebrar;
  (f) **a paleta tem UM dono** (`lib/bi/paleta.ts`): `charts.tsx` e o
  sparkline do Dashboard importam o cobre de lá, e o funil de
  Relatórios/Inteligência passou a usar a rampa validada (a de 5 degraus
  começava no ocre reprovado); (g) a geometria da série é pura e testada
  (`geometriaDaSerie`). **Segunda rodada da revisão** (mesmo dia): (h) **a
  animação das barras nunca rodava** — o `width` inline vence o
  `@starting-style`, então a barra nascia pronta e a transição não tinha de
  onde partir; a largura vai por variável CSS (`--gv-w`) e a classe
  `.gv-barra` lê `width: var(--gv-w)`, que o `@starting-style` pode zerar;
  (i) **o tema escuro tem rampa PRÓPRIA** (`RAMPA_ORDINAL_ESCURA`, creme →
  cobre, validada sobre `#241c13`): o espresso da rampa clara sumia no
  escuro (1,22:1) — a rampa clara invertida não serve, é seleção; os degraus
  moram em tokens CSS (`:root` e `.theme-dark { --gv-funil-N }`, fora do
  `@theme` porque só o `var()` do estilo inline os lê) e o funil pinta por
  `corDoFunil`, que devolve o token — o componente não sabe de tema; o
  teste lê o `globals.css` e confere que os tokens são os valores da lib;
  (j) **rótulo, balão e eixo não colidem**: o rótulo direto é preso dentro
  da área (o pico no primeiro ponto saía pela esquerda), a colisão é pela
  posição PRESA (os dois escorregando para a mesma borda viravam um só
  borrão), o balão perto das bordas se ancora pelo lado de dentro
  (`posicaoDoBalao`), e o rótulo de eixo vizinho do último sai quando
  encostaria nele (12 pontos numa largura curta: "10" colado no "11");
  (k) **dinheiro tem UM formatador** (o `brl` da casa: "R$ 200" sem centavos
  à toa) — a paleta tinha um `toLocaleString` próprio; (l) a região viva do
  leitor de tela é **permanente** nos três gráficos (a que nasce junto com o
  balão não é anunciada), a geometria é memorizada (`useMemo`: não se refaz
  a cada passada do mouse) e o nome antigo `ORDINAL_RAMP` saiu — a rampa tem
  um nome e um dono. **Terceira rodada** (mesmo dia): (m) **o balão era
  invisível no tema escuro** — o `bg-slate-900` vira creme lá e o
  `text-white` é forçado a branco: branco sobre creme (1,1:1), justamente o
  contraste que a rodada anterior consertou nas barras; o balão tem classe
  própria (`.gv-balao`, escuro no claro e claro no escuro); (n) **a seleção
  que sobrevive a uma série mais curta** (toque no 30 dias, voltar para o 7
  com o gesto do navegador) indexava fora da série e derrubava a tela
  inteira na RN-066 — fora da série, não vale; (o) **funil com mais de 4
  etapas** (Relatórios tem 9) ganhava três etapas seguidas da MESMA cor, que
  leem como um grupo e não como progressão: a cor é interpolada entre os
  degraus vizinhos (`color-mix` no mesmo matiz — segue ordinal e monótona),
  com **reserva** para o navegador que não entende `color-mix` (a classe
  `.gv-funil` pinta pelo degrau inteiro, `estiloDoFunil`); (p) **a contagem
  animada do dinheiro pulava de largura no fim**: o `brl` tira os centavos
  do inteiro, então os quadros intermediários tinham centavos e o último
  não (`textoDaContagem`: o valor FINAL decide se todo quadro tem 2 casas
  ou nenhum); (q) o balão do funil saía da tela no celular estreito (uma
  linha, preso à esquerda da barra): fica preso ao cartão e quebra linha;
  (r) **`touch-action: pan-y`** no gráfico de série — sem ele o navegador
  toma o arrasto do dedo como rolagem e a mira congela no primeiro ponto;
  (s) **um foco por gráfico**: cada barra era uma parada de Tab (vinte por
  painel, só para mostrar um balão), agora a lista é o foco e as setas
  andam, como na série. O Dashboard e as outras telas seguem com os gráficos
  de servidor — só a cor mudou de dono. **Limite dito**: os cinzas de grade
  e texto dos gráficos são os tokens das outras telas (o tema escuro os
  inverte); só a cor de DADO foi validada nas duas superfícies.
- **RN-090 · O RELATÓRIO DO PERÍODO EM PDF NÃO FAZ CONTA PRÓPRIA**
  (`lib/bi/relatorio.ts` + rota `/api/bi/relatorio`, botão "Baixar PDF do
  período" no `/bi`, 14/10/2026): a quinta recomendação aceita pelo dono —
  o período que está na tela, em papel, para a reunião com a assessoria,
  para o grupo da gerência, para guardar o mês. Duas decisões: (1) **o
  papel lê os MESMOS objetos que a tela** (`montarPainel`,
  `montarVendedoras`, `montarTendencia`, com o mesmo recorte de `de`/`ate`
  e a régua de dia de `lib/dia`) e o conteúdo é uma função PURA
  (`secoesDoRelatorio`: cada número, cada frase, cada linha de tabela —
  testável sem abrir PDF); se o papel dissesse "R$ 1.200" e a tela
  "R$ 1.234", a loja pararia de confiar nos dois — a régua do painel de
  Recompra ("este painel não faz conta própria", RN-084). O que a tela
  mostra o papel mostra: os seis números com a comparação do período
  anterior **em palavras** ("+12% vs. período anterior"; "sem base de
  comparação", nunca zero disfarçado), as metas do mês (só as preenchidas,
  com o atingido), o funil com a conversão de cada etapa, contatos e
  vendido por dia (linha com total e maior dia), quanto a cliente esperou
  (com %), de onde vieram, por que não fechou (chip e detalhe), **por
  vendedora** (uma linha por pessoa, a desativada marcada, "Sem vendedora" e
  a loja inteira no rodapé — a mesma soma do painel) e os últimos 12 meses;
  e a seção **"Como ler"** diz os limites (robô não é resposta; sem horário
  cadastrado conta a madrugada; dias sem fato). (2) **O desenho é o
  pdf-lib da casa** (a peça do extrato de comissão, RN-038, e das etiquetas,
  RN-059), sem navegador — roda na função da Vercel, com `maxDuration` de
  60 s; todo texto passa por `paginaSegura` (o emoji do motivo de perda não
  derruba o PDF, a lição do romaneio); a série é desenhada ponto a ponto
  com o pico rotulado e o eixo de até 6 datas (o vizinho que colaria no
  último sai), o funil usa a rampa validada da RN-089 e as barras o cobre;
  a página abre sozinha quando a seção não cabe e o rodapé numera. Período
  vazio vira "nenhum contato novo" em cada seção, nunca erro. **Gerência,
  com a chave do módulo** (`porteiraBi`, a mesma das outras rotas do BI);
  o arquivo baixa como `bi-<loja>-<de>-a-<ate>.pdf` (nome limpo: só letra,
  número e hífen). **Dez achados da revisão fecharam a entrega**: o sinal
  de menos é o hífen ASCII (o "−" tipográfico não existe na WinAnsi e o
  papel dizia "+12%" onde a tela dizia "−12%"); o texto é MEDIDO já filtrado
  (medir o cru com emoji no nome de quem gerou derrubava a rota com 500);
  o resumo da série fica acima da área (o pico no fim do mês caía em cima
  dele); o título reserva a altura do primeiro bloco (sem isso ficava órfão
  no pé da página); a tabela que vira página **repete o cabeçalho**; os 12
  meses levam as ressalvas do cartão da tendência ("75% (11 de 30 dias)" e
  "contado a partir de set/26"); "Por vendedora" usa a MESMA régua de vazio
  da aba (`temNumeroNaLoja`); o texto da ponta das barras e as células da
  tabela são medidos (colunas de número com a largura do maior valor, o
  nome com o resto; o que não cabe encolhe e só então corta); e os rótulos
  dos baldes são UMA lista derivada dos limites (`ROTULO_DO_BALDE` em
  `lib/bi/fatos.ts`, lida pela tela e pelo PDF — antes a tela importava do
  módulo do PDF). **Limites ditos**: o PDF é do Painel e das Vendedoras —
  a carteira e o RFM (RN-084/RN-093) e os anúncios (RN-085) não entram nesta
  versão; e o relatório é gerado na hora, a cada clique (não é guardado —
  o período de ontem gerado hoje pode diferir do gerado ontem, porque os
  dias vivos são refeitos, RN-082).
- **RN-093 · O RFM DO BI: NOTAS DA PRÓPRIA LOJA, OITO GRUPOS, E CADA GRUPO
  TEM O BOTÃO DE CHAMAR** (`lib/bi/rfm-regra.ts` pura + `lib/bi/rfm.ts`, topo
  da aba **Clientes** em `/bi`, lista `tipo=rfm`, 23/10/2026): pedido do dono
  — *"todos os CRMs bons têm essa matriz de RFM, e no nosso não tem"* —, para
  enxergar os números E agir: chamar no WhatsApp, campanha e fluxos de
  recompra, aumentando o LTV. Decidido com ele, em quatro respostas: (1) **as
  notas de 1 a 5 são da PRÓPRIA loja**, por percentil de 20 em 20%
  (`notasPorPercentil`) — dias fixos seriam injustos entre a loja que repõe
  a cada 15 dias e a que compra por coleção; empate leva a MESMA nota (a
  ordem de leitura não decide), e o lado do empate é o que não engana
  (achado da revisão): em F e V o bloco empatado leva a nota do **pé** —
  "comprou uma vez" é o bloco enorme de quase toda loja e não sobe por ser
  comum (pelo meio do bloco, quem tinha 2 compras levava a mesma nota de
  quem tem 10) —, e em R a do **topo** (quem comprou no mesmo dia é
  igualmente recente; a loja que vendeu para todas hoje não vê todas
  Perdidas); R pelos dias desde a última compra (menos dias, nota maior);
  (2) **Frequência e Valor contam os ÚLTIMOS 12 MESES** — o RFM diz quanto a
  cliente vale HOJE; quem não compra há mais de 12 meses é **Perdida, sem
  nota**, e as notas comparam só quem comprou nos 12 meses (a sumida de três
  anos não empurra todo mundo para cima); (3) os **oito grupos saem de R ×
  FV** (FV = a média de F e V, o meio arredondado para cima; `grupoDe`):
  🏆 Campeãs (R ≥ 4 e FV ≥ 4), 💚 Fiéis (R 3 e FV ≥ 4), ✨ Promissoras (R ≥ 4
  e FV ≤ 3), 🌱 Novatas (R ≥ 4 e PRIMEIRA compra da vida), 👀 Precisam de
  atenção (R 3 e FV ≤ 3), 🚨 Não posso perder (R ≤ 2 e FV ≥ 4), 😴
  Hibernando (R 2 e FV ≤ 3) e 👋 Perdidas (R 1 e FV ≤ 3, ou sem compra nos 12
  meses) — **nenhum se chama "Em risco"**: é a faixa da aba Recompra (dias
  fixos, RN-084), e a mesma palavra com outra régua faria a loja ver dois
  números para o mesmo nome; (4) **só gerência vê**, só nas lojas com o BI
  (a porteira de sempre, RN-082). **A população é a da carteira**: pedido
  pago COM data de pagamento (RN-001), valor `netTotal` sem frete (RN-002),
  cliente da loja (RN-013), agregada no banco numa linha por cliente — o e2e
  confere que RFM e carteira contam as mesmas compradoras e o mesmo total.
  **É calculado, nunca gravado**: cancelar a venda tira a cliente do grupo na
  hora (a régua do selo, RN-063). Cada grupo mostra quantas são (% das
  clientes), quanto venderam em 12 meses e **% da receita** (as oito fecham
  100, `porcentagensQueFecham`, que passou a morar em `insights-puro`), o
  **LTV médio** (vendido na vida ÷ clientes) e a ação sugerida; a loja tem o
  LTV médio dela, e com menos de 20 clientes com nota a tela diz que o
  percentil oscila. **A matriz clássica** R (5 → 1) × FV (1 → 5) é um mapa de
  calor de **um matiz em quatro degraus**, com a cor fazendo UM trabalho
  (quantas clientes) e o grupo dito por emoji e nome (RN-089): degraus
  validados com o validador da casa nas duas superfícies (o mais perto da
  superfície ≥ 2:1) e com a **tinta do número escolhida por degrau** (≥ 4,5:1
  em todos — o cobre puro dá 4,27:1 com preto e 4,09:1 com branco, então não
  é degrau), em tokens CSS (`--rfm-calor-N`/`--rfm-tinta-N`) que o teste
  confere contra `paleta.ts`; no escuro, mais clientes clareia. A Novata mora
  nas células de cima e a legenda diz. **Cada número abre a lista** (RN-086)
  — por grupo ou por célula, da que mais comprou na vida para a que menos —
  e cada linha tem **"Chamar"**: abre a conversa pelo caminho do "Recuperar
  venda" (`POST /api/conversations` + `?texto=`) com a **mensagem do grupo**
  já no campo (`mensagemDoGrupo`: uma por grupo, o primeiro nome, nunca "Oi,
  Contato!" para o crachá provisório) — quem envia é a pessoa, pelo número
  da loja, com registro (RN-017). **O link da mensagem é rastreado**
  (achados da revisão): leva o código pessoal da cliente (`?c=`, RN-021 —
  sem ele um dígito errado no catálogo criava cadastro novo) e, se ela tem
  **dona ATIVA na carteira, a ref DELA** (RN-005): a gerência chamando a
  cliente da Ana não toma a venda nem a carteira; **sem dona, sem ref** — a
  venda é da loja e a carteira não muda para quem clicou. A linha diz de
  quem é a carteira, e cliente **bloqueada ou sem celular** não ganha o
  botão (a linha diz por quê). Nome, telefone, bloqueio, código e dona vêm
  na MESMA consulta agregada (a lista nunca conta uma linha que não mostra).
  Junto, dois
  defeitos achados ao montar a tela: a página do BI importava `lerAba` do
  `abas.tsx` (arquivo do navegador) e **caía ao abrir** — passou a vir da lib
  pura, com teste; e no celular a aba Clientes ficava mais larga que a tela
  (os cartões das VIPs sem `min-w-0`). Provado contra o Postgres local
  (`scripts/e2e-rfm.ts`: campeã, novata, a que parou, a sumida de mais de um
  ano, cancelado/orçamento/pago sem data/outra loja fora, somas contra o
  banco e contra a carteira, as oito listas com o Chamar). **Próximas
  etapas combinadas** (uma de cada vez, com revisão): o grupo no filtro das
  campanhas (gerência — feito, RN-098); tarefa para a vendedora dona da cliente quando ela
  CAI de grupo (feito, RN-100); o retrato mensal de quem subiu e quem caiu
  (feito, RN-101). **Limite dito**:
  o "Chamar" da gerência numa conversa encerrada a reabre no nome de quem
  abriu (a régua do "Conversar no WhatsApp").
- **RN-098 · O GRUPO DO RFM NO FILTRO DAS CAMPANHAS: SÓ A GERÊNCIA, E SEM
  PERMISSÃO O PÚBLICO É VAZIO** (`rfmGrupo` em `lib/segments.ts` +
  `modeloDeCampanhaDoGrupo` em `lib/bi/rfm-regra.ts` +
  `lib/campanha-mensagem.ts`, tela Campanhas, 27/10/2026): a Etapa 2 do RFM
  (RN-093) — *"criar campanha e fluxos voltados à recompra"*. A campanha
  ganha o filtro **"Grupo do RFM"**, cruzado com os de sempre (sem compra há,
  tipo, cidade, tag…), e o público é o grupo de **HOJE**, pela MESMA conta
  da aba Clientes (`clientesDoRfm`; o público da campanha já era dinâmico —
  quem muda de grupo entra ou sai sozinha). **A porteira é a do BI**
  (`rfmLiberadoPara` = `podeVerBi` + `biEnabled`, RN-082): gerência, na loja
  com a chave — a campanha não vira porta dos fundos para a vendedora, ou a
  loja sem o módulo, saber quem é "Não posso perder". O servidor confere em
  TODA porta — criar (403 com frase), prever (403) e o disparo (ler o
  público e marcar enviado, 403) — e, por baixo delas, **`evaluateSegment`
  devolve público VAZIO** para quem não pode, para grupo fora da lista e
  para grupo sem ninguém hoje: ignorar o filtro que a pessoa não pode usar
  mandaria o "sentimos sua falta" para a loja inteira. A campanha de RFM
  vista por quem não pode aparece **sem o número e sem o Disparar**, com o
  motivo certo (`barreiraDoRfm`: "só a gerência" para a vendedora; "o BI
  está desligado" para a gerente da loja que desligou o módulo). **Filtro
  salvo que não se lê é RECUSADO** (`lerFiltroDaCampanha` devolve `null`,
  o disparo responde 422 e a tela diz "crie de novo"): antes ele virava
  `{}`, e filtro vazio é "todas as clientes" — o JSON cortado de uma
  campanha "Não posso perder" virava disparo para a loja inteira (achado
  da revisão). E **cliente BLOQUEADA não entra em campanha nenhuma**
  (`blockedAt: null` no público de TODA campanha, com ou sem o grupo): o
  bloqueio é o de verdade no WhatsApp, e a lista do BI já não lhe
  oferecia o "Chamar" (achado da revisão). O grupo é conferido **em
  memória** depois da consulta (a régua do gasto mínimo — uma lista de ids
  no `IN` esbarraria no teto de parâmetros do Postgres), e a tela calcula o
  RFM **uma vez** para todas as campanhas (`gruposDoRfmUmaVez`, com a
  permissão lida da loja que a tela já carrega — sem ida extra ao banco).
  **A
  mensagem pronta** do grupo entra ao escolhê-lo (enquanto ninguém mexeu no
  texto): é a MESMA do "Chamar" do BI com a saudação "Oi {{nome}}!"
  (`modeloDeCampanhaDoGrupo`, o teste prende que, personalizada, ela é
  igual), com o link do catálogo da loja. **O atalho "Criar campanha"** em
  cada grupo do BI abre a janela com o grupo, o nome e a mensagem prontos
  (`/campanhas?rfm=<grupo>`). Dois consertos do disparo, que a campanha de
  RFM ia usar: o `{{nome}}` do crachá provisório ou do nome em branco some
  junto com o espaço (`personalizarCampanha`: "Oi!", nunca "Oi Contato!") e
  o número do wa.me sai pela régua da casa (`normalizePhone` — número de
  fora não ganha 55, RN-096); a vírgula de "Olá, {{nome}}!" sai junto
  ("Olá!", nunca "Olá,!"). **Limites ditos**: marcar "enviado" refaz o
  público da campanha (é assim que ela se conclui sozinha) e, com o grupo,
  o RFM da loja a cada clique — uma consulta agregada por clique; o disparo da campanha
  segue abrindo o WhatsApp do aparelho (wa.me), não a Central — o link da
  mensagem é o do catálogo da loja, sem a ref da dona nem o código da
  cliente (para isso, o "Chamar" da lista do BI, RN-093); e a vendedora
  continua criando campanha sem o grupo, como sempre.
- **RN-100 · QUANDO A CLIENTE CAI PARA UM GRUPO DE ALERTA DO RFM, A DONA DA
  CARTEIRA RECEBE UMA TAREFA** (`lib/bi/rfm-quedas-regra.ts` pura +
  `lib/bi/rfm-quedas.ts` + `RfmEstado`, 27/10/2026): a Etapa 3 do RFM
  (RN-093), decidida com o dono — *"tarefa para a vendedora; só a gerência
  vê o RFM, a vendedora recebe a tarefa"*. Como o RFM é calculado e as notas
  são relativas à loja (mexem todo dia), saber que alguém CAIU exige
  memória: `RfmEstado` guarda, por cliente, o grupo da **última rodada** (não
  é o grupo dela — é a lembrança; a tela segue calculando). **A régua da
  queda** (`caiuParaAlerta`): a ordem é a da tela (`GRUPOS_RFM`, do melhor ao
  mais distante — uma ordem só) e só vira tarefa a queda que **ENTRA num
  grupo de alerta** — Precisam de atenção, Não posso perder, Hibernando,
  Perdidas; Campeã que vira Fiel continua comprando, é movimento, não
  alarme. **Só cliente com dona ATIVA** ganha tarefa; a queda da cliente da
  loja (sem dona) **ESPERA** — a memória não anda — e a tarefa nasce na
  rodada em que a gerência a der a uma vendedora (gravar a memória ali
  calaria a queda para sempre, achado da revisão). A tarefa é da dona
  (`assigneeId`), **vence às 23:59 de hoje em SP** (`vencimentoDaQueda` —
  na meia-noite exata ela caía em "Próximas" e não fechava sozinha no mesmo
  dia, achado da revisão), "Não posso perder" é prioridade ALTA, e o tipo é sempre de CONTATO
  (FOLLOW_UP/REATIVAR) — então **falar com a cliente ou ela comprar de novo
  fecha a tarefa sozinha** pelos caminhos de sempre (`contato-feito`,
  `fecharTarefasResolvidas`). **Uma tarefa de queda aberta por cliente**: cair
  de novo antes de alguém chamá-la ATUALIZA a mesma (`rfm-queda:<grupo>:<id>`),
  nunca empilha — e a atualização **não conta no teto, não toca a data** (a
  vendedora pode ter adiado para o dia que a cliente pediu) e não gera aviso.
  **Sem enxurrada**: a primeira vez que a cliente aparece é o ponto de
  partida (ligar o BI numa loja de 800 clientes não cria 800 tarefas), e o
  mesmo vale para a **memória com mais de 7 dias sem rodada fechada**
  (`Company.rfmQuedasOkEm` — o BI desligado e religado não vira meses de
  quedas "de hoje", achado da revisão); há **teto de `TETO_POR_DONA` (10)
  tarefas NOVAS por vendedora por rodada** — as que passaram do teto ficam
  **seguradas** com a memória antiga, marcadas com `seguradaDesde`, e **vão
  na frente** na rodada seguinte (quem espera há mais tempo primeiro, depois
  o maior LTV — só por LTV, a cliente de pouco valor perdia a vez para
  sempre, achado da revisão). Memória e tarefas nascem
  na **MESMA transação** (tarefa sem memória repetiria amanhã; memória sem
  tarefa calaria a queda para sempre, a lição da RN-092), só para cliente
  que ainda existe na loja (RN-013), e quem saiu do RFM (venda cancelada)
  tem a memória apagada. **Roda de carona** (sync da inbox e abertura do BI,
  `quedasDoRfmSeDevido`): trava atômica por loja, **uma rodada por DIA de
  São Paulo** (`ondeDaTrava`, `Company.rfmQuedasRunAt` — um intervalo em
  horas escorregava e punha duas rodadas no mesmo dia, dobrando o teto,
  achado da revisão), **só com a chave do BI** — nunca um 3º cron
  (ADR-002); rodada que falha mantém a trava e vai para a Saúde sem alarme
  (a régua da RN-082) — nada se perde, porque a memória só anda quando a
  transação fecha. Depois do commit, **um aviso por vendedora** no celular
  ("📉 N clientes suas esfriaram"), contando só as tarefas NOVAS de fato
  gravadas. **Na Agenda**, o "Conversar" da tarefa de queda abre com a
  **mensagem do grupo** e o link com o código da cliente e a ref da dona
  (`linkDaClienteDoRfm`, o mesmo caminho do "Chamar" do BI — e a dona vale
  só se ativa E da loja, a régua da consulta do RFM), nunca a genérica de
  conversa parada. **Limites ditos**: como as notas são
  da própria loja, uma cliente pode cair só porque as outras compraram mais
  (o teto segura o barulho); a cliente que esfria sem passar por um grupo de
  alerta (Campeã → Fiel) não gera tarefa — ela aparece no retrato do mês.
- **RN-101 · O RETRATO DO MÊS NO RFM É RECALCULADO, NUNCA GRAVADO — QUEM
  CAIU, QUEM SUBIU E QUEM CHEGOU** (`lib/bi/rfm-movimento-regra.ts` pura +
  `lib/bi/rfm-movimento.ts`, cartão "O mês no RFM" na aba Clientes do BI,
  lista `tipo=rfm-mov`, 27/10/2026): a Etapa 4 do RFM (RN-093) — o dono quer
  ver, mês a mês, quem subiu e quem caiu. **A decisão que sustenta tudo**: o
  RFM de qualquer instante sai dos pedidos pagos ATÉ aquele instante
  (`carregarBaseDoRfm(companyId, instante, { soPagoAntes: true })` corta
  `paidAt < instante` — e SÓ quando pedido: no RFM de agora, o pagamento com
  o relógio do aparelho uns minutos à frente sumiria da aba, das campanhas e
  das quedas, achado da revisão), então "como estava no dia 1º" é a MESMA conta da aba com o relógio no dia
  1º à 0h de SP (`inicioDoMes`), e o fim é o dia 1º do mês seguinte — ou
  AGORA, no mês em curso. Nada é gravado: a loja vê os meses de trás no
  primeiro dia em que abre a tela (uma foto gravada só teria história de
  hoje em diante), e a venda cancelada depois sai também do passado — o
  retrato diz a verdade de hoje sobre aquele mês. **A régua do movimento**
  (`movimentoDe`) é a ordem da tela (`GRUPOS_RFM`, do melhor ao mais
  distante), a MESMA das quedas (RN-100): ir para um grupo melhor é SUBIR
  (a Perdida que volta a comprar sobe), para um pior é CAIR, e quem não
  tinha compra paga no dia 1º e comprou no mês **CHEGOU**. O cartão mostra os
  três números (caíram, subiram, primeira compra — cada um abre a lista), os
  que ficaram e os que **não têm mais compra paga hoje** (venda cancelada ou
  devolvida a orçamento, ou contato unificado — dizer só "cancelada" mandava
  procurar um cancelamento que não houve), **os caminhos mais
  comuns** ("🏆 Campeãs → 🚨 Não posso perder: 3" — as quedas primeiro, pelo
  tamanho; cada caminho abre a lista) e, por grupo, quantas no dia 1º,
  quantas agora e o saldo (a conta fecha: fim = começo + entraram −
  saíram, e o teste prende). Os meses são o corrente e os cinco anteriores
  (`mesesDoRetrato`; a URL aceita os últimos 12, `lerMesDoRetrato` — o futuro
  e o texto torto são recusados —, e o escolhido mais velho que os seis
  ganha o seu botão); trocar o período da aba **não perde o mês escolhido**
  e voltar da lista cai no cartão (`#retrato`). **A lista** é a do BI
  (RN-086) com o caminho escrito em cada linha — no mês fechado, as notas e
  a última compra da linha são as do **fim daquele mês** (ditas assim) e só
  o "Chamar" fala com a cliente de **HOJE** (mensagem do grupo de hoje; a que
  não tem mais compra paga não ganha o botão) —, pelo mesmo `linhaDoRfm` da
  lista dos grupos; o nome da origem é UM (`rotuloDaOrigem`, cartão e lista
  dizem o mesmo). A cor
  faz um trabalho (RN-089): o sentido, com a seta e a palavra dizendo o
  mesmo. **Limites ditos**: como as notas são da própria loja, a cliente pode
  subir ou cair só porque as outras compraram (o cartão diz); a aba faz duas
  contas agregadas do RFM no mês em curso (o dia 1º e agora — e o "agora" é
  reaproveitado para os grupos e a matriz, `rfmDasClientes`), três num mês
  fechado; a lista de um mês fechado também faz três (o grupo de hoje
  precisa da loja inteira, as notas são relativas).
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
  **A SINCRONIZAÇÃO É EM ETAPAS, COM ORÇAMENTO DE TEMPO E RASTRO**
  (`syncPaginaDeProdutos`, 15/09/2026): relato da Entre Linhas — "não está
  fazendo sincronização", com o cartão dizendo *"interrompida no meio"*. A
  etapa de 25 produtos faz de 200 a 450 idas ao banco (medido no Postgres
  local), e com o banco em outra região a 100 ms cada isso passa dos 60s da
  Vercel: a função morria SEM resposta, a tela só sabia dizer "interrompida"
  e a lojista recomeçava da página 1 para morrer no mesmo lugar. Agora cada
  etapa tem **orçamento de 25s** (`MS_ORCAMENTO_DA_ETAPA`): o que não coube
  volta como **parcial** e a tela pede a MESMA página pulando o que já foi
  feito (`desde`) — **sempre pelo menos um produto por etapa**, senão a tela
  pediria a mesma etapa para sempre. Etapa que morre sem resposta é repetida
  2× antes de desistir, e a mensagem diz **onde** parou (página e produto),
  que é o que o suporte precisa; o **rastro** (`lastSyncEtapa`, gravado
  ANTES de trabalhar e apagado no fim) faz o cartão dizer "parou na página
  N" mesmo depois de a função morrer. Junto, a rodada ficou mais leve: baixa
  pendente (RN-053) e preço a caminho (RN-057) são lidos **uma vez por
  rodada** (pools), e a variação só vai ao banco quando algo mudou.
  **RN-053 · O ENVIO DE ESTOQUE PARA A NUVEMSHOP NÃO SE PERDE CALADO**
  (`lib/nuvemshop-estoque-pendente.ts` + `pushStockToNuvemshop`, 10/09/2026):
  relato do dono — a mesma peça com **0 aqui e 41 lá**, e a conferência da
  integração dizendo *"o vínculo está certo"*. Não era o vínculo: era o
  **aviso da baixa que nunca chegou**. Duas causas, as duas mudas: (1) a
  resposta do PUT era **jogada fora** — token vencido, 422, 500 ou o timeout
  de 15s passavam como sucesso; (2) a chamada era **solta**
  (`push(...).catch(() => {})`), e a Vercel **congela a função junto com a
  resposta** — o envio nem chegava a acontecer. É a MESMA lição da RN-033, e
  agora o caminho é um só: `espelharEstoqueSemQuebrar`, dentro do `after()`.
  O desenho da fila é o da RN-028 (o arquivo do WhatsApp que não chegou), que
  já provou funcionar: a peça é marcada **ANTES** da tentativa e só sai quando
  a Nuvemshop **CONFIRMA**; o que sobrou é repescado **de carona no tráfego**
  (sync da inbox e abertura do Estoque), com espera crescente (30s → 6h) e
  trava atômica por loja (`Company.nsEstoqueRunAt`) — **nunca um 3º cron**
  (ADR-002) —, com orçamento de tempo porque cada PUT pode levar 15s. **Uma
  fila por PEÇA** (único por `variantId`): o que se manda é o estoque de
  AGORA, **relido imediatamente antes do PUT**, então dez baixas seguidas da
  mesma variação são um envio só — enfileirar por movimento mandaria número
  velho por cima do certo. E **sucesso só conta quando o que chegou lá é o que
  temos aqui** (`confirmarEnvio` confere o número contra o cadastro): outra
  venda da mesma peça no meio de um PUT de 15s fazia o envio "dar certo" com o
  número velho, e o sucesso com número velho era indistinguível do sucesso de
  verdade — a divergência voltava calada (achado da revisão). Não bateu, a
  peça FICA na fila e a repesca manda o certo.
  **O botão Sincronizar NÃO passa por cima da baixa pendente**: ele PUXA o
  número de lá, e no estado ⚠️ o mais novo é o NOSSO — a venda aconteceu aqui
  e o aviso não chegou. Puxar devolveria as peças vendidas ao catálogo, ou
  seja, a loja voltaria a vender o que não tem: exatamente o estrago que esta
  regra existe para evitar (e era a saída que o próprio aviso recomendava).
  Peça com envio pendente fica de fora da gravação de estoque da sync.
  **Loja desconectada não perde a baixa**: a peça FICA na fila e o dia da
  reconexão acerta o número. Peça que perdeu o vínculo (ou virou "infinito"
  lá) sai da fila em vez de tentar para sempre. **Desistir é explícito**:
  acabadas as tentativas a peça PARA de ser tentada (a linha perde a data, que
  é o que a repesca lê) e o caso APARECE — linha na Central de Comunicação
  (`nuvemshop.estoque-nao-enviado`) e caso no painel de Saúde, com o nome da
  peça. **A linha não é apagada**: apagando, o ⚠️ sumia da tela justo na peça
  que de fato ficou divergente. Ela sai sozinha quando um envio daquela peça
  for confirmado, e **qualquer movimento novo da peça REABRE a rodada** — sem
  isso ela ficava divergente para sempre: o token vence às 9h, a peça esgota
  as tentativas às 18h, a lojista renova às 19h e nada mais repescava. E o **alarme toca UMA vez por rodada de tentativas**, nunca a
  cada venda: desistência que vira spam faz a loja parar de ler a Central. E a divergência **aparece na própria linha**
  (⚠️ no Inventário e na tela Produtos, com a frase e o caminho): antes ela só
  aparecia para quem rodasse a conferência da integração — foi assim que a
  peça ficou dias com o número errado de um dos lados, e divergência de
  estoque ou faz a loja deixar de vender peça que tem, ou vender peça que não
  tem.
  **RN-072 · UMA PEÇA DAQUI ESPELHA UMA VARIAÇÃO DE LÁ — E SKU REPETIDO
  LÁ NÃO CASA POR SKU** (`escolherAlvos` em `lib/nuvemshop.ts`, 07/10/2026):
  relato do dono com o print da Regata Quadrada — *"aqui consta 50, e no
  nuvem 4"*. Na Nuvemshop, P, M, G e GG da Azul Marinho estavam todos com o
  SKU "RQD-MAR-P" (a Nuvemshop copia o SKU ao montar a grade). A trava de
  ambiguidade da Toque Leve só olhava SKU repetido AQUI; repetido LÁ, as
  quatro variações casavam com a nossa P, uma depois da outra, e **a última
  lida ganhava** — a P mostrava o número de outro tamanho, os outros ficavam
  zerados e sem vínculo, e toda venda da P daqui avisava a Nuvemshop na peça
  ERRADA (RN-053). E corrigir o SKU lá **não bastava**: o mapa de vínculos é
  a foto do começo da rodada, e a P que casava com a P de lá pelo SKU voltava
  para a M pelo vínculo velho no mesmo laço. Agora a escolha é feita ANTES do
  laço e **cada peça daqui é alvo de UMA variação de lá por rodada**, nesta
  ordem de confiança: (1) vínculo que um SKU confiável confirma; (2) SKU que
  aparece uma vez só no produto de lá (sem tirar de outro produto de lá a
  peça dele quando a variação de lá já tem vínculo próprio — era assim
  antes); (3) para SKU **repetido** lá, a **cor × tamanho do produto já
  identificado** — SKU repetido não confirma nada, então não casa por SKU nem
  segura vínculo velho, e a cor × tamanho nunca toma peça que espelha OUTRO
  produto de lá (a cópia do produto feita lá não arrasta a grade do
  original) nem passa por cima da trava da cor; (4) o vínculo que sobrou,
  se a peça ficou livre (quem trocou o SKU só lá segue espelhado, como
  sempre). SKU repetido também **não identifica o produto daqui** (a cópia
  do produto feita lá arrastaria a grade do original): sem vínculo nenhum,
  nada é escrito e tudo vira pendência. Com isso **o estado torto se desfaz
  sozinho na sincronização seguinte**, mesmo antes de a lojista corrigir o
  SKU, a ordem em que a Nuvemshop devolve as variações não muda o resultado,
  e **religar tira o carimbo de quem o tinha** — duas peças daqui ligadas à
  mesma de lá fariam a venda da antiga avisar a Nuvemshop na peça errada. O que a cor × tamanho
  não resolve vira **pendência "repetido LÁ"** (a tela diz que o conserto é
  na Nuvemshop: cada variação com o seu SKU) — nunca variação nova com SKU
  ambíguo, nunca segunda escritora na mesma peça (nem peça que espelha
  outro produto de lá), e o SKU repetido **não é copiado** para a ficha daqui
  — nem no produto novo espelhado, que nasce ligado pelo vínculo e ganha o
  SKU quando ele for corrigido lá. As pendências do laço vão também para o
  relatório guardado quando quem chama é o webhook (antes sumiam), sem
  repetir a mesma (a mesma peça com conselho novo troca o conselho). E a
  **conferência não chama de "vínculo cruzado"** o par cujo SKU é repetido
  DENTRO do mesmo produto de lá e que tem a MESMA cor × tamanho — ali o SKU
  diferente do daqui é o esperado, e o botão "soltar" desfaria justamente os
  vínculos certos; o G daqui ligado à M de lá segue sendo cruzado. A conta
  do "repetido" é UMA função (`skusRepetidos`) para a sincronização, o
  produto espelhado, a conferência e a **prévia antes de conectar**
  (`nuvemshop-simulacao.ts`), que passou a seguir a mesma regra — a prévia
  nunca engana. Provado contra o Postgres local
  (`scripts/confere-sku-repetido-la.ts`, 14 conferências: o código antigo
  deixava a P com o número do GG e os outros três zerados; o novo põe cada
  tamanho no seu, desfaz o vínculo errado sozinho em qualquer ordem da API,
  mantém o produto de lá gravado na peça religada — sem ele a venda não
  avisaria a Nuvemshop —, respeita a trava da cor e não se repete). **Limite**: SKU repetido
  em produtos DIFERENTES da Nuvemshop não é visto pela rodada (ela olha um
  produto por vez) — a conferência da integração pega (`SKU_DUPLICADO_LA`).
  **RN-057 · O PREÇO DE VAREJO DA PEÇA NUVEMSHOP TAMBÉM SE MUDA AQUI, E VAI
  PARA LÁ** (`lib/nuvemshop-preco-pendente.ts` + `pushPriceToNuvemshop`,
  15/09/2026): pedido do dono com o print da Entre Linhas — a lojista abriu
  o reajuste em lote (RN-056) e viu *"varejo: é da Nuvemshop, muda lá"* em 25
  peças, ou seja, mudar 25 preços na mão na loja online. Trancar era a
  resposta errada; a certa é MANDAR o número daqui para lá. O desenho é o da
  RN-053 (estoque), que já provou funcionar: a pendência
  (`NuvemshopPrecoPendente`, **uma por PRODUTO** — o varejo é do modelo, e
  todas as variações vinculadas recebem o mesmo número) nasce **na MESMA
  transação que grava o preço** (ficha da peça e reajuste em lote — preço
  novo aqui sem ninguém para mandá-lo é o reajuste que a sync desfaz na hora
  seguinte) e some só quando a Nuvemshop **CONFIRMA** o preço que temos
  AGORA (relido antes de cada PUT; sucesso com número velho não é sucesso).
  **Enquanto ela existe, a sync NÃO escreve o varejo de lá por cima**
  (`precosPendentes` em `upsertProduct`). O envio vai pelo `after()`
  (`espelharPrecoSemQuebrar`, depois do commit), a API recebe o preço como
  texto com duas casas por variação vinculada (produto inteiro só confirma
  com TODAS), e o que sobrou é repescado **na MESMA rodada, com a MESMA trava
  e o MESMO relógio da fila de estoque** (estoque primeiro: vender peça que
  não tem é o estrago maior) — nunca um 3º cron (ADR-002). Loja desconectada
  segura na fila; produto que perdeu o vínculo sai dela. Desistir é
  explícito (`nuvemshop.preco-nao-enviado` na Central + Saúde, uma vez por
  rodada) e a linha FICA: a ficha mostra **"⏳ enviando"** enquanto tenta e
  **"⚠️ não chegou na Nuvemshop"** com o motivo depois de desistir (um
  booleano só dizia "tenta sozinho" para quem já tinha parado — achado da
  revisão); mudar o preço de novo reabre a rodada. A fila pega carona
  **também na tela Produtos e na porta do reajuste** — loja sem a Central
  aberta e sem o módulo Estoque não tinha outra batida, e é ali que ela olha
  o ⏳. Quatro achados da revisão fecharam buracos que a versão trancada
  nunca teve: (1) a ficha manda o varejo **só se a pessoa MUDOU o número**
  — o carregado empurraria para a loja online um preço que ela já tinha
  mudado lá (a RN-050 ao contrário); (2) **ZERO nunca vai para a loja
  online** (a peça ficaria de graça lá): a ficha recusa com frase, o lote
  deixa de fora e diz, e o envio desiste dizendo o motivo — três trancas
  (`decidirVarejoParaNuvemshop`); (3) só **VARIAÇÃO vinculada** espelha
  (o PUT é por variação; produto 1↔1 com as variações todas em pendência de
  SKU não tem o varejo lido nem escrito pela sync — é nosso); (4) a fila é
  marcada em **duas consultas para a lista inteira**, não duas por peça
  (centenas de peças dentro da transação de 30s estourava o relógio e
  desfazia o reajuste). O **Jueri continua trancando os DOIS preços** (a
  sync dele grava os dois e não há porta de volta), e o atacado da peça
  Nuvemshop segue só daqui, como sempre. A régua vive em `donoDoPreco`
  (`espelhaVarejo`), uma para a ficha e para o lote — e a ficha DIZ "vai
  para a Nuvemshop" ao lado do campo.
  **Jueri** (sync 2x/dia via cron `jueri-sync`, 03:00 e 12:00 de Brasília).
  **RN-077 · A SINCRONIZAÇÃO AUTOMÁTICA DA JUERI ACOMPANHA A JUERI — FOTOS
  INCLUSIVE — E DEIXA RASTRO** (`lib/jueri-sync.ts`, 09/10/2026): relato do
  dono — *"a cliente mudou as fotos lá na Jueri e não atualiza no sistema;
  ela vende na Jueri e o estoque aqui não muda"*. O cartão dizia "última
  importação 06/10, 11:13" — hora de clique no botão, não de cron. Três
  defeitos no automático: (1) as **fotos nunca eram trocadas** depois da
  primeira importação, por regra escrita no sync ("nunca sobrescreve fotos
  que a loja já cuidou aqui"); (2) o cron **não tinha orçamento de tempo**:
  a loja rodava página a página até a Vercel cortar a função (300 s) sem
  rastro nenhum — `lastSyncAt` só é marcado na última página, nunca
  chegava, e a loja "mais atrasada" ia PRIMEIRO na rodada seguinte para
  morrer no mesmo lugar (cada página custava 40 `findFirst` + 40 `update`,
  ~15 s com o banco em outra região); (3) o resultado voltava num JSON que
  ninguém lê. Agora: **as fotos da Jueri acompanham a Jueri** (`decidirFotos`
  — a foto da Jueri leva a marca `ProductImage.source = "JUERI"` e o produto
  guarda a LISTA da Jueri na última sincronização, `Product.jueriFotos`;
  "começa com http" não serve de marca porque a foto da Nuvemshop também é
  link, achado da revisão. Só quando a Jueri MUDA a lista — foto nova,
  tirada, ordem — as marcadas são trocadas pelas de agora, **no lugar em
  que as antigas estavam** (a capa da loja continua capa); a foto da loja e
  a da Nuvemshop ficam, e o que a loja fez nas fotos da Jueri entre uma
  rodada e outra, tirar uma ruim ou mudar a capa, fica até a Jueri mudar de
  novo. Produto que nunca sincronizou fotos: sem foto nenhuma ganha as da
  Jueri, como sempre; com fotos de outra origem nada é tocado, só a lista é
  anotada. A migração marca as fotos-link dos produtos que são da Jueri e
  não da Nuvemshop, e anota a lista; o produto das duas fica sem marca);
  **chamada à Jueri com tempo limite** (20 s — o prazo só é conferido entre
  páginas, e uma chamada pendurada passaria do corte sem rastro); **a fila
  do cron é ordenada pela TENTATIVA** (`lastSyncTentativaEm`), não pela
  importação completa — a loja grande em etapas iria primeiro para sempre e
  comeria o prazo das outras; **reconectar zera** a página pendente e o
  erro; **SKU repetido na mesma página** (referência igual em duas cores)
  acha o produto recém-criado em vez de estourar o único e travar a
  página; **uma consulta por página** em vez
  de quarenta, e produto igual em preço, custo, ativo e vínculo **não vai ao
  banco** (`produtoMudou`); o cron tem **prazo único para a fila** (240 s) e
  cada loja **para por conta própria entre páginas** quando ele chega,
  gravando a página seguinte (`JueriConnection.lastSyncPagina`) — a próxima
  rodada **RETOMA de lá**, sempre pelo menos uma página por rodada, e
  `lastSyncAt` segue sendo a importação COMPLETA; página que falha ganha
  uma nova tentativa e, falhando de novo, o erro diz a página e a rodada
  seguinte volta nela; **cada rodada deixa rastro**: no cartão da conexão
  (quando tentou, página pendente, último erro em vermelho com o caminho
  "o botão faz o mesmo agora"), na Central de Comunicação da loja
  (`jueri.sync`, OK com a contagem ou ERRO) e, na falha, na Saúde (sem
  alarme — o token vencido falharia duas vezes por dia e calaria o canal
  das emergências, régua da RN-066). Nome e categoria continuam da loja
  (auditoria 07/08/2026); estoque, preço, custo e ativo continuam da Jueri.
  **Limites ditos**: foto que a loja subiu aqui num produto da Jueri fica
  (ela é da loja), a Jueri que apagar todas as fotos deixa o produto só
  com as da loja, e a foto da Jueri trocada pela legada "foto principal"
  do editor (que apaga e recria a linha) perde a marca e vira foto da loja. Provado contra o Postgres local com uma Jueri de mentira
  (`scripts/e2e-jueri-sync.ts`): estoque e fotos acompanham, foto da loja
  fica, rodada parcial retoma, falha deixa rastro.
- **Marketing**: Gestor de Bio (temas, cores custom, capa, QR, métricas
  BioView/BioClick com filtro de data, atribuição `utm_source=bio` no
  catálogo), campanhas de aquisição, tracking do catálogo
  (TrackSession/TrackEvent + `lib/tracking/insights.ts` → tela
  Inteligência), afiliados (só empresa-plataforma).
  **RN-061 · CURVA ABC POR PEÇA na Inteligência** (`lib/tracking/curva-abc.ts`
  + `curvaAbcStats`, 20/09/2026): pedido do dono — *"quero entender quais
  produtos mais vendem, peça por peça (regata alça preta M), e a quantidade
  em unidades, ligado ao filtro de período"*. A tela já dizia qual COR e
  qual CATEGORIA mais saem; a curva desce até a **variação exata** (produto
  × cor × tamanho), que é o que se repõe, corta e separa. Cada linha traz
  **unidades**, % do total, acumulado e faturamento (fatia do `netTotal`,
  RN-002), no **período da tela** (só pedido pago, pela data do pagamento,
  RN-001 — a MESMA régua dos quadros de cor/categoria, e o teste prende
  isso). **A classe é pelo acumulado**: A são as peças que, juntas, fecham
  80%; B as que completam 95%; C o resto — por **unidades** (padrão, o que o
  dono pediu) ou por **faturamento** (chavinha na tela e no CSV; a mesma
  peça pode ser A em unidade e B em dinheiro, e a tela diz qual base está
  olhando). **A chave da peça é o PRODUTO (pelo id) × cor × tamanho**, com o
  rótulo do **cadastro de hoje** no que ainda existe (renomear a peça ou a
  cor não a divide em duas) — agrupar pela VARIAÇÃO foi a primeira versão e
  a revisão achou o buraco: a variação apagada e recriada com a mesma cor e
  tamanho (a lojista refaz a grade) deixa os itens antigos sem variação
  (SetNull) e a mesma peça virava duas linhas; pelo produto são uma.
  **Diferença dita** em relação ao quadro de Cores, que agrupa pela cor
  CONGELADA no item ("Preto" renomeado para "Preta" são duas linhas lá e uma
  aqui; o que é igual é QUAIS peças contam e quanto valem); produto apagado
  agrupa pelo nome congelado, normalizado (a régua do `chaveDoNome`). Quem
  cruza os 80% ainda é A (folga de ponto flutuante, não arredondamento); sem
  base — todo mundo faturou zero — ninguém é A; rateio negativo não entra; o
  resumo por classe soma o valor CRU e a última classe com peça leva a sobra
  do centavo (A + B + C fecha EXATAMENTE com o total, régua da RN-030). Os
  itens vendidos do período são lidos **UMA vez** para os quatro quadros de
  dimensão e a curva (`itensVendidosNoPeriodo`; eram cinco varreduras da
  mesma tabela). Regra pura e testada (`curva-abc.test.ts`, com o banco
  simulado prendendo a régua da consulta; `scripts/confere-curva-abc.ts`
  prova contra o Postgres que unidades e faturamento batem com Cores e Visão
  Geral, inclusive depois de apagar e recriar a variação). **Navegar pela
  curva não recarrega a página** (`curva-abc-view.tsx`, pedido do dono pelo
  celular em 20/09/2026: "uma forma mais fluida de navegar pelas classes" e
  "quando clico para ver mais ela chega a travar" — cada clique era um link
  que refazia as quinze consultas da Inteligência): o servidor manda a curva
  PRONTA nas duas bases e o navegador troca a base, **filtra por classe**
  (tocando no cartão da classe ou nos chips Todas/A/B/C, mantendo a POSIÇÃO
  da peça na curva inteira — filtrar por B mostra "90.", não "1."), **busca
  por palavras** sem acento (a régua da lupa da Central) e **mostra mais em
  blocos** de 50 sobre as 25 primeiras; o endereço acompanha a base por baixo
  (`replaceState`) para o CSV e o link compartilhado; acima de 3.000 peças
  o resto fica no CSV e a tela diz. A base é preferência de leitura,
  preservada ao trocar o período (atalhos, Limpar, formulário) e nos links da
  Recuperação — e vice-versa. No celular cada peça é um cartão de duas linhas
  (nome e classe; "un. · % · acum." e faturamento). Anúncio → campanha
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
- **Produtos · RN-056 · Reajuste de preço em lote por CATEGORIA**
  (`lib/reajuste-preco.ts`, botão "Reajustar preço" na tela Produtos,
  15/09/2026): pedido do dono — a cliente queria mudar o preço de uma
  categoria inteira sem abrir peça por peça. Gerência escolhe a categoria,
  **atacado e/ou varejo**, e **percentual** (+10%, −5%) ou **valor fixo**;
  a tela mostra a **prévia** (quantas mudam, antes → depois, o que fica de
  fora e por quê) e só então aplica. Quem faz a conta é o SERVIDOR, nos
  dois passos, sobre o que está no banco na hora — a tela nunca manda preço
  pronto. Réguas: centavos (2 casas), **nunca negativo**, percentual dentro
  de −90% a +500% (fora disso é dedo errado), **percentual não cria preço
  onde está ZERO** (10% de nada é nada, e a peça que nunca teve atacado não
  pode ganhar um por engano — fica de fora e é contada; valor fixo, sim,
  vale para ela). **Peça do Jueri tem os DOIS preços lá** e fica de fora
  com o motivo dito na prévia (mesma régua da RN-014/RN-050). Peça da
  Nuvemshop: o atacado é daqui e o **varejo muda aqui E VAI PARA LÁ**
  (RN-057; na primeira versão ele ficava trancado, e o print da Entre Linhas
  mostrou 25 peças "muda lá" — foi trocado no mesmo dia). **Gerência e SUPORTE** (`podeReajustarPreco`; decisão do dono em
  15/09/2026 — o suporte já edita a ficha da peça, preço inclusive, e
  trancar só o lote o obrigava a mudar 80 peças uma a uma); vendedora não.
  Tudo numa transação, por loja
  (RN-013), com registro na Central de Comunicação
  (`produtos.reajuste-de-preco`: quem, categoria, regra e o antes/depois de
  até 200 peças — é o que permite desfazer à mão). O aplicar **TRAVA** as
  peças da categoria (`FOR UPDATE`) e **reconta com o número do banco
  naquele instante** — a ficha salva entre a prévia e o clique não é
  sobrescrita em silêncio (achado da revisão). A mesma régua de dono vale
  na **ficha da peça**: o preço do Jueri aparece com cadeado, não
  viaja no salvamento, e o servidor (PATCH do produto) recusa número
  diferente do de lá — antes a tela aceitava e a sync devolvia o número
  de lá horas depois ("o sistema perdeu meu preço", a RN-050 em preço).
  A conta pura mora em `lib/reajuste-preco-regra.ts` (é o que a tela
  importa; o arquivo com banco não pode chegar ao navegador).
- **Etiquetas** (gated por loja, `Company.etiquetasEnabled`, porteira em
  `lib/etiquetas/gate.ts`; desenhado com o dono em 18/09/2026, em quatro
  etapas — código por variação, etiqueta de embalagem com impressão em lote,
  editor de modelos, separação de pedido por leitor; **preço de tabela A
  DEFINIR pelo dono**, 0 no catálogo de módulos até lá; ADR-017). **Área
  própria no menu** (`/etiquetas`, item gated; pedido do dono: "não deveria
  ficar em Configurações, precisa ser bem completo"), com as abas
  **Modelos** e **Imprimir**; a **Separação** é área própria no menu
  (`/separacao`, decisão do dono em 19/09/2026: quem separa está na arara e
  não passa por Modelos/Imprimir — a mesma chave do módulo abre as duas).
  **Modelos** (`lib/etiquetas/modelos.ts`, rotas `/api/etiquetas/modelos`):
  três TIPOS — embalagem (com o código de barras), composição (tecido,
  tamanho grande, cuidados, loja: a etiqueta que a Toque Leve imprime no
  OpenLabel) e envio (endereço da cliente e número do pedido, dados da
  FICHA, régua da RN-022; o NOME é o de documento, `nomeParaDocumentos` —
  CNPJ com razão social sai pela razão, RN-024) —, cada um com UM **padrão** por loja (índice
  parcial único, semeado na primeira abertura com o desenho por regra do
  tipo, `layoutPorTipo`), e quantos modelos a loja quiser: criar, duplicar
  (leva o desenho congelado), definir como padrão (transação), arquivar (o
  padrão não se arquiva; a linha nunca é apagada). **O editor**
  (`editor-de-modelo.tsx`): tamanho do rolo, colunas, espaço, girar;
  elementos de **texto fixo**, **campo da peça/pedido** (`CAMPOS`, por
  tipo), **código de barras** e **imagem**; arraste e redimensionamento na
  área de desenho (escala em px/mm, passo de meio milímetro), ordem,
  propriedades (letra, negrito, alinhamento, **várias linhas** com quebra
  por palavra — `quebrarTexto`/`linhasDoElemento`, regra única para as
  três saídas), e "como sai no rolo" pela mesma função que imprime. O
  desenho gravado é uma lista de elementos (`EtiquetaModelo.elementos`,
  JSON) que o servidor **lê campo a campo** (`lerElementos`: elemento
  torto cai fora, imagem só PNG/JPEG em data-URL com teto, bitmap só em
  hexadecimal do tamanho certo) e confere que cabe (`elementosCabem`) antes
  de gravar; sem elementos vale o desenho por regra, e tamanho/colunas/giro
  são os da LINHA (o JSON de opções só diz quais campos o desenho por regra
  mostra). **Imagem** vai nas três saídas: PDF embute PNG/JPEG uma vez, SVG
  usa `<image>`, e a Zebra recebe `^GF` com o **bitmap preto e branco que o
  NAVEGADOR rasterizou ao salvar** (`lib/etiquetas/rasterizar.ts`, 8 pontos
  por mm no tamanho em que a imagem está — no servidor não há canvas; a
  parte pura, `empacotarBits`/`pretosDoRgba`, é testada). **Composição da
  peça** (`Product.composition`, na ficha) com **padrão por categoria**
  (`ComposicaoCategoria`, painel na aba Modelos): a peça só preenche quando
  difere — a régua do NCM (RN-055); `composicaoEfetiva` decide. **Imprimir**
  (`imprimir-view.tsx`): escolhe o modelo; por peça (busca, a grade inteira
  com uma etiqueta por peça em estoque) ou por pedido pelo número
  (`/api/etiquetas/pedido`, respeita RN-007) — com modelo de envio vira a
  etiqueta do pacote × cópias (`orderId`/`copias` na rota de impressão). Os
  botões da ficha da peça e do pedido continuam usando o padrão de
  embalagem.
  **RN-059 · O CÓDIGO DE BARRAS DA VARIAÇÃO NASCE COM A PEÇA E NUNCA MUDA**
  (`lib/etiquetas/ean13.ts`, migração `20260918100000`): cada cor × tamanho
  tem um **EAN-13 interno** (prefixo 2, faixa de uso interno do GS1 — nunca
  colide com produto de mercado; é o formato que todo leitor lê de fábrica e
  que a Zebra desenha nativo) gerado pelo **BANCO num gatilho BEFORE INSERT**
  a partir de uma sequência única da plataforma — toda variação nasce com
  código, venha da ficha, da Nuvemshop, do Jueri, da importação ou da
  produção. Regra no banco de propósito (ADR-017): são cinco caminhos de
  criação no código e "esqueceu um" é a classe de defeito que mais custou
  aqui. O código é **único na plataforma** e **nunca reescrito** (etiqueta
  colada na peça tem que continuar valendo); a leitura no bipe recorta pela
  loja (RN-013). A conta do dígito verificador existe em SQL e em TypeScript
  e `scripts/confere-codigo-de-barras.ts` prova que concordam. **O código
  existe com ou sem a chave do módulo**: a chave só abre as portas de
  imprimir e bipar. **A etiqueta de embalagem** (`lib/etiquetas/modelo.ts`,
  `zpl.ts`, `pdf.ts`, `svg.ts`): UMA lista de elementos em milímetros,
  montada por regra a partir das opções da loja (tamanho, **colunas do rolo
  e espaço entre elas** — o rolo da Toque Leve tem 4 etiquetas de 23 × 48 mm
  lado a lado —, **girar** (automático: etiqueta mais alta que larga sai com
  o desenho deitado, girado 90° horário, senão o EAN teria barra de 0,125 mm
  que muito leitor não lê), nome da loja, SKU, preço — Configurações →
  Etiquetas, gerência e suporte editam). Uma "página" (PDF) ou "etiqueta"
  (ZPL, `^PW` = largura de todas as colunas) é UMA LINHA do rolo, e o lote
  é expandido por quantidade e agrupado de `colunas` em `colunas`
  (`expandirLote`/`linhasDoRolo`; linhas iguais em sequência viram `^PQ`).
  A rotação em ZPL usa orientação R com `^FO` no canto superior esquerdo da
  caixa girada — o visualizador externo é bloqueado pela rede da sessão,
  então o ajuste fino se confere na impressão de teste; PDF e prévia são
  exatos (matriz `0 -1 1 0`). O modal tem **"cópias de cada"** (um número
  para todas as linhas) e **"repetir o lote ×N"**. Desenhada
  por três saídas que leem a MESMA lista — ZPL para a Zebra 220 (203 dpi,
  `^CI28` + escape hexadecimal, `^BE` nativo com 12 dígitos), PDF na medida
  exata (uma página por etiqueta, para qualquer impressora pelo driver) e
  SVG para a prévia — então o que a lojista vê em Configurações é o que
  sai (posição, tamanho e corte do texto; o **peso da letra é o de cada
  saída** — a Zebra só tem UMA fonte escalável embutida, sem par
  regular/negrito, limite aceito). O número embaixo das barras é desenhado
  por nós nas três saídas (a linha de interpretação da própria Zebra tinha
  altura que ela decide e invadia o rodapé, achado da revisão). Texto que não cabe **encolhe até 60% e só então corta** com "…"
  (`encaixarTexto`, regra única; o PDF mede com a fonte de verdade). Quem
  monta nome, código e preço é o **SERVIDOR**, do cadastro, recortado pela
  loja — a tela manda só (variação, quantidade); peça de outra loja ou
  apagada recusa o lote inteiro com frase E diz QUAIS (o modal marca as
  linhas), nunca imprime metade calado; teto de 500 etiquetas por vez.
  Variação sem código (só possível se alguém inserir com o gatilho fora)
  ganha um na hora de imprimir, pela mesma função do banco e só onde está
  nulo — código existente nunca é reescrito. O modelo padrão da loja é UM
  por (loja, tipo) no banco (índice parcial, P2002 tratado, régua da
  RN-031). Impressão **em lote** pela ficha da peça
  (a grade inteira, sugerindo uma etiqueta por peça em estoque) e pelo
  pedido (só as peças dele, na quantidade de cada linha). **Zebra direto
  pelo navegador** (`lib/etiquetas/browser-print.ts`): o Zebra Browser Print
  instalado no computador da loja escuta em `localhost:9100` e o modal manda
  o ZPL para ele quando o encontra; sem ele, PDF ou arquivo ZPL. **Toda a
  equipe imprime** (decisão do dono: operação de quem está na arara).
  **RN-060 · SEPARAÇÃO DE PEDIDO POR LEITOR: O BIPE SÓ ACEITA O QUE ESTÁ
  NO PEDIDO, NA QUANTIDADE DO PEDIDO, E FICA REGISTRADO QUEM SEPAROU**
  (`lib/etiquetas/separacao-regra.ts` + `separacao.ts`, item **Separação**
  no menu — `/separacao` e a tela do bipe `/separacao/[pedido]` —,
  18/09/2026): o
  pedido do dono — *"vou separar o pedido #110 bipando; o sistema só
  permite o registro se for a peça que realmente está no pedido, respeita
  a quantidade; tem que ser rápido e seguro"*. A **fila** é todo pedido
  **PAGO (RN-001) que ainda está na loja** (pago, em produção, separação —
  enviado/entregue já saíram), do mais antigo para o mais novo, recortada
  pela visibilidade de pedidos (RN-007), com **quem está separando** na
  linha (duas pessoas não pegam o mesmo pedido sem saber; pedido sem
  nenhuma peça fica fora; acima de 500 a tela DIZ que cortou). Abrir a tela
  **não cria nada** — a separação ativa nasce no **primeiro bipe ACEITO**
  (a gerente que abre só para olhar, ou um bipe errado, não vira "em
  separação por" na fila de todo mundo; a versão que criava a linha antes
  de avaliar deixava uma separação viva por um bipe recusado — reproduzido
  no Postgres na revisão). O leitor é um
  teclado (digita o código e aperta Enter), e **a regra é PURA e a MESMA
  nos dois lados**: o navegador responde na hora (verde e bip agudo aceita;
  vermelho e bip grave recusa — *peça errada* quando o código não é de
  nenhuma linha do pedido, *peça a mais* quando a linha já está completa,
  *ilegível* quando o EAN não fecha) e manda o bipe aceito para o
  servidor em segundo plano, que é a **segunda tranca**: aplica a mesma
  regra sobre o que está gravado, sob **trava por pedido**
  (`pg_advisory_xact_lock`), e quem bipa **assume** a separação. **Uma
  separação ativa por pedido** (índice parcial único; a segunda aba relê).
  A mesma variação em duas linhas do pedido é UMA na separação (soma), e
  peça sem código (apagada do cadastro) aparece à parte para conferir na
  mão. **Concluir só libera com TODA linha fechada** — bipada ou declarada
  em **FALTA** ("não tem na arara", nunca além do que sobrou). **A contagem
  que vale é a do SERVIDOR**, bipe a bipe: o número que o navegador manda
  não sobe contagem nenhuma (a primeira versão aceitava o maior dos dois e
  concluía "4 de 4 bipadas" sem um bipe confirmado — achado da revisão);
  bipe que ficou sem conexão é mandado de novo ANTES de concluir, e se não
  chega, não conclui. Do navegador entra só a falta declarada. **O servidor
  lê o pedido de AGORA a cada bipe** (`mesclarComGravado`: o pedido manda
  em quantidade e código, o gravado manda na contagem) — a lojista que
  acrescenta peça no meio tem a peça aceita no bipe seguinte; a foto de
  quando abriu recusava a peça nova como "errada". E **confere o status
  dentro da transação**: pedido cancelado ou devolvido a orçamento no meio
  não aceita bipe nem conclusão. Concluir carimba `Order.separadoEm` **no
  mesmo comando que confere o status** (a tela do pedido não passa pela
  trava desta separação: cancelou entre a leitura e a escrita, zero linhas
  e nada fica gravado), muda o status para **SEPARAÇÃO** só de PAGO/EM
  PRODUÇÃO (condicionado — nunca por cima de um ENVIADO gravado no meio; a
  troca entra no histórico como toda troca), escreve no histórico do pedido
  *"Separado com leitor por Fulana: N de M peças bipadas. FALTOU: …"* e,
  com falta, avisa no sino a vendedora do pedido
  (sem dona, a gerência): o pacote sai incompleto e alguém precisa falar
  com a cliente. A transição passa pela porta do Financeiro (RN-033), como
  toda transição. **Pedido que muda depois de separado VOLTA para a fila**
  (`desfazerCarimboDeSeparacao`, chamado pela porta de edição do pedido
  quando o **PACOTE** muda — variação × quantidade, `pacoteMudou`; só
  preço não conta, senão a equipe conferia de novo o que já estava pronto
  — e pelas portas que o fazem voltar a ser pago: reaberto de cancelado na
  tela e Pix do gateway): o pacote de ontem não é o pedido de hoje, e sem
  isso ele sumia da fila como se estivesse pronto. **A tela que fica aberta
  enquanto OUTRA conclui não bipa por cima**: cada bipe, falta e conclusão
  leva o **carimbo visto** (`Order.separadoEm` que a tela carregou, `carimbo`
  na rota), e carimbo diferente do banco é recusado com
  `motivo: "concluida-fora"` — a tela vira "concluído em outra tela" (sem
  o carimbo, a aba velha abria uma segunda separação por cima da concluída,
  achado reproduzido na revisão). A lista "separados nos últimos 7 dias" é
  SÓ pelo carimbo: o pedido separado de manhã e enviado à tarde continua na
  conferência. **Pedido que SAI da fila com separação em andamento**
  (cancelado, devolvido a orçamento ou a aguardando pagamento) tem o
  rascunho **DESCARTADO** (`Separacao.descartadaEm`, `descartarSeparacaoAtiva`
  nas DUAS portas que tiram pedido da fila — a edição do pedido e o
  cancelamento vindo da Nuvemshop —, decididas pela mesma função pura
  `saiuDaFila`; as duas tomam a MESMA trava por pedido do bipe, senão o
  primeiro bipe, que ainda vai criar a separação, se cruzava com o descarte
  e o rascunho nascia depois dele — achado da revisão): as peças voltaram para a arara e "2 de 5
  bipadas" não vale mais — ao voltar a pago, recomeça do zero, numa linha
  nova (o índice parcial de "uma ativa por pedido" ignora a descartada).
  Pergunta do dono (19/09/2026): pago → orçamento → pago de novo **não
  duplica** — a fila é derivada do pedido, uma linha por pedido; o que se
  repete é só o registro no histórico, que é o correto. **Modo bancada**
  (chavinha na tela do bipe, preferência do aparelho): a resposta de
  concluir já traz o **próximo** da fila — o mais antigo que **ninguém mais
  está separando** (abrir sozinho o pedido da colega faria o primeiro bipe
  assumir a separação dela) — e a tela o abre sozinha em 3s (com "não abrir
  desta vez") — quem separa 40 pedidos por dia não volta para a lista a cada
  um. O endereço antigo da aba e da tela do bipe redireciona para cá. A lista de status da fila é **derivada** da lista de venda
  (RN-001) menos quem já saiu, e o teste a confere contra a lista do
  Estoque — três listas à mão é onde um status novo se perde. Pedido **sem nenhuma peça com
  código** (item da loja online que não casou por SKU, item de texto
  livre) conclui como **"conferido na mão"** e o histórico diz — senão
  ficava na cabeça da fila para sempre. Pago sem data de pagamento (pedido
  antigo) é o mais antigo da fila, não o último. Pedido já separado pode
  ser separado de novo (a tela avisa; vira nova conferência no histórico).
  **Toda a equipe separa** (decisão do dono: "todos usuários, desde que
  fique registrado o usuário que separou"). O que não se prova sem banco
  (trava, status na transação, histórico, aviso) está em
  `scripts/confere-separacao.ts`, contra o Postgres local.
- **Estoque** (gated por loja, `Company.estoqueEnabled`, porteira em
  `lib/estoque/gate.ts`; desenhado com o dono em 09/09/2026 e entregue em
  quatro abas — Inventário, Mínimos, Painel, Produção (e, desde 08/10/2026,
  Trocas, RN-073); **preço de tabela A
  DEFINIR pelo dono**: está 0 no catálogo de módulos, então NÃO entra no MRR
  até ele dizer; ADR-016): a tela **Inventário** (`/estoque`) — uma linha por cor ×
  tamanho com **na loja · reservado · disponível**, busca por nome/código/
  SKU/tag, filtros (baixo, zerada, com reserva, por integração), **ajuste na
  própria linha com motivo** e o histórico da peça. **Os cartões do topo
  seguem a CATEGORIA escolhida** (`resumirLinhas`, pedido do dono em
  08/10/2026: *"quando seleciono uma categoria quero ver o estoque total
  daquela categoria; em Todas, o total de todas"*) — a busca e os chips não
  mexem neles (número que muda a cada tecla não merece confiança), e a tela
  diz de qual categoria são os totais. **A linha reservada diz QUAL pedido
  segura** (`anexarPedidosQueSeguram`, mesmo dia, pedido do dono: *"na aba
  Com reserva, o status do pedido e o número dele"*): embaixo do número
  reservado, cada pedido com número (link), situação e quantas peças — a
  MESMA consulta da recusa de remover variação (RN-050); o pedido de colega
  fora do recorte (RN-007) chega do servidor sem número e sem id, só com a
  situação e a quantidade. **Folha de contagem**
  (`/contagem-de-estoque`, botão "Imprimir contagem", `lib/estoque/contagem.ts`,
  pedido do dono em 28/09/2026): A4 para contar na arara, agrupada por
  CATEGORIA e modelo, no MESMO recorte da lista (categoria, busca,
  inativos) e sem o teto de 500 — é no Inventário filtrado que a contagem
  volta a ser digitada. **As cores de cada categoria saem em ORDEM
  ALFABÉTICA** (pedido do dono, 05/10/2026, print da Toque Leve: a folha
  seguia a ordem do cadastro — "Off-white, Azul Marinho, Preto…" — e
  repetia o cabeçalho "Baby Look" a cada cor, porque a loja cadastra um
  produto por cor): o modelo da folha é o NOME do produto (mesmo nome na
  mesma categoria = um grupo só), as cores de A a Z e, dentro da cor, os
  tamanhos na ordem da arara. Compara com o **na loja** (a peça separada
  para pedido ainda está fisicamente lá) e mostra o reservado, porque o
  número que se digita é o disponível (contado − reservado); opções de
  **contagem às cegas** (sem o número do sistema) e **uma categoria por
  folha**; peça de dono externo sai marcada (o acerto é lá, RN-050). Só lê.
  **A folha segue também o CHIP** (`filtro=`, pedido do dono em 08/10/2026:
  *"faço o filtro para saber quais peças estão baixas, mas não tem como
  imprimir — preciso passar para a produção"*): com **No mínimo** ou
  **Zeradas** ela vira **lista de produção** (`ehListaDeProducao`) — título
  "Peças para produção", colunas disponível, mínimo, **falta** (quanto
  precisa para voltar ao mínimo, `faltaParaOMinimo`) e "Produzir" em branco
  para anotar, sem a contagem às cegas (ali o número é o assunto); o botão
  do Inventário passa a dizer "Imprimir lista para produção". Toda a equipe entra
  (conferir estoque é operação); **quem ajusta é gerência** — a porta de
  escrita confere de novo. O número que se edita é o DISPONÍVEL (o `stock`
  da peça, o mesmo de Produtos e do catálogo); o **reservado sai do LIVRO DE
  MOVIMENTOS** dos pedidos que ainda estão dentro da loja (orçamento,
  aguardando pagamento, pago, em produção, separação — enviado/entregue já
  saíram), nunca da quantidade do item (reserva parcial segurou menos).
  Pedido cancelado com **baixa definitiva** e reaberto (REANEXAR, RN-004)
  NÃO conta como reservado: a peça foi embora de verdade. A ficha do pedido
  mostra o MESMO número do livro ("o pedido tem 10 — só 4 estavam no
  estoque"). O livro tem índice por pedido e `OrderItem` por variação/produto
  (migrações 20260909180000 e 20260909181000 — sem eles, cancelar um pedido
  e remover uma variação varriam a tabela da PLATAFORMA inteira).
  **Painel e Produção são só de GERÊNCIA** (`podeVerAnaliseDoEstoque`):
  ali estão valor a custo, a atacado, vendas da loja inteira e dinheiro em
  tecido — a régua de Relatórios; vendedora e suporte veem só o Inventário.
  O cartão do Dashboard conta em UMA SQL (`contarNoMinimo`) com a mesma
  expressão do mínimo — carregar a loja inteira para devolver um número era
  o item mais caro da tela mais aberta (achado da revisão de performance).
  **RN-050 · Sistema de fora que vende MANDA no estoque; ajuste digitado tem
  UMA porta** (`lib/estoque/dono-do-estoque.ts` + `lib/estoque/ajuste.ts`):
  pedido do dono — *"caso o cliente tenha Nuvemshop ou outro sistema de
  e-commerce ou marketplace, esse outro sistema continua mandando no estoque"*.
  Já era a régua da RN-014, mas a tela Produtos não a respeitava: aceitava o
  número digitado numa variação vinculada, gravava aqui e NÃO mandava para a
  Nuvemshop — a sync seguinte voltava por cima ("o sistema perdeu meu
  ajuste") e, no meio, o catálogo vendia peça que a loja online já tinha
  vendido. Agora peça vinculada (`ProductVariant.nuvemshopId` — o vínculo é
  por VARIAÇÃO, cor/tamanho que não existe lá segue nossa — ou
  `Product.jueriId`, por produto) é **só leitura nas DUAS telas**, com
  cadeado, o nome do dono e o botão de sincronizar (a mesma porta em etapas
  da tela Configurações); número IGUAL passa em silêncio (a tela Produtos
  manda a grade inteira a cada salvamento), número diferente é RECUSADO com
  frase — a tela nem abre o campo, o servidor é a segunda tranca. Venda
  (RN-003) e produção (`lancaNoEstoque`) continuam mexendo em peça vinculada:
  são movimentos REAIS e o espelho para a Nuvemshop sai junto; o que a regra
  barra é o AJUSTE DIGITADO por cima do número de outro sistema. **Todo
  estoque digitado passa por `ajustarEstoque`**: loja (RN-013), papel (dito
  por quem chama: gerência no Inventário; na tela Produtos quem edita o
  produto, como sempre foi — trancar a vendedora que cadastra a grade seria
  mudança de carona), dono, **motivo obrigatório** (no Inventário a pessoa
  escolhe; em Produtos o livro registra "edição do produto") e a gravação
  **condicional ao número que a pessoa VIU**: o Inventário manda o número
  que a tela mostrava e a porta recusa se já mudou (devolvendo o atual);
  a gravação em si é `updateMany where stock = antes`, para a corrida de
  milissegundos. Duas pessoas contando a mesma arara, a segunda leva "o
  estoque mudou enquanto você editava" em vez de sobrescrever a colega.
  Número e linha do livro (`InventoryMovement` AJUSTE, "por Fulana: motivo
  (antes → depois)") nascem na MESMA transação — um sem o outro é o
  histórico mentindo. Na tela Produtos a conferência vem ANTES de gravar
  qualquer coisa (foto inclusive — a capa apagada não volta) e **a ficha
  inteira é UMA transação** (fotos, grade, estoque, dados): antes cada passo
  gravava sozinho e a recusa no meio deixava a peça pela metade (achado da
  revisão). A tela Produtos **não manda** o número da variação vinculada
  (mandar o que carregou faria a ficha ser recusada toda vez que a loja
  online vendesse entre abrir e salvar). O histórico da peça mostra o
  movimento para toda a equipe, mas o número e o link do pedido só para
  quem enxerga aquele pedido (`orderScope`, RN-007) — e o TEXTO do motivo
  ("Reserva — pedido #482") é mascarado para "pedido de colega" fora do
  recorte (achado da revisão de segurança). O botão "Sincronizar" só existe
  para a Nuvemshop (o Jueri sincroniza sozinho, 2x/dia). **A grade de peça
  vinculada também se mexe LÁ**: remover variação da Nuvemshop "não pega"
  (a sync recria com o número de lá e o livro dela some em cascata) e cor/
  tamanho novos em produto do Jueri criam peça que ninguém sincroniza — a
  rota recusa os dois, e variação com peça RESERVADA em pedido **que ainda
  não é venda** (orçamento, aguardando pagamento) não se remove (o pedido
  perderia a prova do que segurou) — e a recusa **diz QUAL pedido segura**
  (`fraseDaPecaPresa` + `pedidosQueSeguram`, 25/09/2026, print de uma
  lojista com vários pedidos abertos: "cancele o pedido" sem número era beco
  sem saída): número, cliente, situação e peças de cada um, pela MESMA régua
  do reservado; o de colega fora do recorte entra só como "pedido de colega"
  (RN-007). **Pedido PAGO não trava** (`travaARemocao`, derivado da lista de
  venda da RN-001; mesmo dia, o dono com o print: os dois pedidos eram de
  SEPARAÇÃO — *"separação já vendeu, então não pode segurar"*): a peça já é
  da cliente, e o item guarda nome, cor e tamanho congelados — perde só o
  vínculo, e com ele o código de barras (na Separação ela aparece "sem
  código, conferir na mão", RN-060). **Ninguém fica no escuro**
  (`lib/estoque/remover-variacoes.ts`): todo pedido EM ABERTO que tinha a
  peça — o pago e também o orçamento que não chegou a reservar (falta) —
  ganha no histórico a nota de quem removeu, e quem removeu recebe na hora
  o aviso com os números (`avisoDaRemocao`), dizendo também que, se o
  pedido for cancelado, a peça não volta sozinha ao estoque (a variação não
  existe mais). A conferência roda no COMEÇO da transação, antes de gravar
  foto, travando **os pedidos e depois as variações** (as que a ficha vai
  ajustar entram no mesmo passe, senão é deadlock com a reserva): o pedido
  pago que volta a orçamento no meio, e a reserva nova, esperam —
  reproduzido no Postgres local, e sem a trava do pedido a remoção passava
  por cima do orçamento. **A cor que já é de OUTRO produto na Nuvemshop se
  SEPARA em produto próprio** (`gruposParaSeparar` +
  `lib/estoque/separar-variacoes.ts`, ícone na linha da cor na ficha da
  peça, 01/10/2026, relato da Entre Linhas): a peça tinha "Azul" e
  "Laranja" num produto só; a lojista criou lá um produto para a Azul, a
  sync casou o SKU e RELIGOU a variação que já existia aqui — dentro da peça
  antiga —, e o "remova lá" virou beco. **Move, nunca apaga**: a variação
  vai inteira (mesmo id, **mesmo código de barras** — etiqueta colada segue
  valendo, RN-059 —, mesmo livro, mesma fila de envio) para o produto daqui
  ligado ao produto de lá dela (o que já existir, recusando cor × tamanho
  repetida pela régua da sync; ou um novo, "Base — Cor" como no padrão
  produto-por-cor, com preços, custo, categoria, NCM, composição, mínimo e
  catálogo de campanha da peça; destino INATIVO é recusado — a cor sumiria
  do catálogo), as fotos etiquetadas só com aquela cor vão junto, os
  **itens de pedido acompanham** (`OrderItem.productId` — a porta de edição
  do pedido confere variação × produto), o catálogo de campanha da peça vale
  também no destino e o varejo a caminho da Nuvemshop (RN-057) ganha fila no
  produto NOVO (o que já existia tem o preço dele, e reenviar o dele não
  levaria o reajuste junto). Apagar e deixar a sync recriar
  foi a primeira versão, recusada na revisão: código novo (o bipe da
  Separação dizia "peça errada"), histórico perdido e atacado zerado.
  **O pedido que já apontava para a peça antiga não se perde**
  (`ProductVariant.separadaDeId`, migrações 20261001120000 e o índice
  parcial 20261001120100): o pedido do catálogo que estava no aparelho
  (RN-010) e o rascunho de pedido guardam produto antigo + cor, e as três
  portas de pedido (catálogo, criação e edição) ainda acham a variação por
  esse rastro — sem ele, a linha não achava a peça e o catálogo recusava o
  pedido INTEIRO, que o reenvio descartava. Separável é o grupo cujo produto de lá
  (`nuvemshopProductId`, ou o da peça) não é o que a peça espelha, e o grupo
  sai INTEIRO (irmã deixada para trás faria a sync voltar a achar a peça);
  vínculo antigo sem produto de lá conhecido trava tudo até a próxima sync.
  O botão é **discreto, na linha** (não uma faixa de alerta): existe loja
  que agrupa aqui, de propósito, cores que lá são produtos separados. Tudo
  numa transação com as variações TRAVADAS e relidas, fila por produto de
  lá (`pg_advisory_xact_lock` — duas separações para o mesmo destino viram
  uma só) e registro na Central de Comunicação (`produtos.cor-separada`).
  Provado no Postgres local com o `upsertProduct` e a rota do catálogo de
  verdade: a sync do produto novo atualiza a cor no lugar novo (tamanho
  novo lá entra nele), a do antigo não devolve nada, e o pedido antigo do
  aparelho entra com a Azul no produto novo. **Limites aceitos e ditos**:
  uma etapa de sincronização que já estava rodando no instante da
  separação pode ainda gravar uma vez na peça antiga (ela leu antes; a
  próxima acerta); a **sacola** guardada no aparelho perde a cor separada
  (a vitrine confere o estoque de hoje por produto + cor, RN-067, e a
  cliente vê o aviso de ajuste); só o ÚLTIMO salto de separação é lembrado;
  e a separação que cruza, no mesmo segundo, com a edição de um pedido
  daquela cor pode ser abortada pelo banco (impasse) — volta frase e nada
  fica pela metade. A restauração pós-
  importação (`stock-restore.ts`) pula peça de dono externo pelo mesmo
  motivo. A tela Produtos **só manda o estoque que a pessoa DIGITOU** (com
  o número visto): mandar o carregado de todas desfazia a venda que entrou
  enquanto a ficha estava aberta. Loja sem o módulo não muda em NADA na
  tela — mas a regra do dono externo vale COM ou SEM a chave, porque o bug
  era de toda loja com Nuvemshop.
  **RN-051 · Mínimo por PEÇA, por CATEGORIA e da LOJA, com alerta SEM SPAM**
  (`lib/estoque/minimos.ts` + `lib/estoque/alerta.ts`, aba Mínimos e coluna
  "Mín." do Inventário, 09/09/2026): pedido do dono — *"um alerta para cada
  peça ou categoria dizendo qual é o mínimo que posso ter"*. Três degraus e
  vale o MAIS ESPECÍFICO: a peça (`Product.minStock`, vale para CADA cor ×
  tamanho do modelo) > a categoria (`EstoqueMinimoCategoria`) > a loja
  (`Company.lowStockThreshold`, o número que já existia). A régua é a de
  sempre — **CHEGOU ao mínimo = disponível ≤ mínimo, ZERADA INCLUSA** —, e
  é UMA para o Inventário (filtro "No mínimo", para onde o sino manda), o
  painel ("o que repor" tem TODA peça no mínimo, com "—" quando a sugestão
  é 0 e "na Nuvemshop" para dono externo), o alerta, o monitor da tela
  Produtos e o cartão "Estoque baixo" do Dashboard (`contarNoMinimo`):
  antes o cartão e o monitor olhavam só o número da loja, e a primeira
  versão do filtro excluía as zeradas — o sino dizia 7 e a lista abria com
  2 (achado de três revisões). O
  **alerta** chega no sino e no push da gerência, e não vira ruído por duas
  decisões: **uma variação avisa UMA vez** (carimbo
  `ProductVariant.lowStockAlertedAt`, que só zera quando ela SOBE acima do
  mínimo — a peça que a loja decidiu não repor não aparece todo dia) e **um
  aviso por rodada, em resumo** ("7 peças chegaram ao mínimo", as primeiras
  pelo nome, "e mais N", link para a lista). Produto inativo não avisa e
  solta o carimbo. **Variação que NASCE zerada não avisa** (grade nova "vou
  produzir", importação com 0): foi cadastrada no mínimo, não chegou nele —
  só avisa depois que teve peça (algum movimento no livro). Carimbo e aviso
  nascem na MESMA transação (carimbar antes e o aviso falhar deixava a peça
  muda para sempre); falha da varredura devolve a trava e vai para o painel
  de Saúde. A varredura não carrega o reservado (não precisa dele) e tem
  freio em memória por instância antes da trava do banco (a batida do sync a
  cada 3s não vai ao banco para nada). Renomear ou apagar categoria leva o
  mínimo dela junto. Roda **de carona** (sync da inbox e abertura do Estoque)
  com trava atômica por loja (`Company.estoqueAlertaRunAt`, 30 min) — nunca
  um 3º cron (ADR-002) — e SÓ com o módulo ligado (`estoqueEnabled` entra
  na própria trava). Mínimo 0 é mínimo válido (só zerada avisa), diferente
  de "sem mínimo". Quem define é gerência; todos veem.
  **RN-052 · Análise de estoque por REGRA, e a aba Produção só LÊ**
  (`lib/estoque/analise.ts` + `lib/estoque/producao.ts`, abas Painel e
  Produção, 09/09/2026): o dono pediu "análise inteligente"; alinhado com
  ele, inteligente aqui é conta que a lojista entende e confere — sem IA.
  Quatro perguntas, cada uma com a régua dita na tela: **giro** = peças
  vendidas nos últimos 30 dias, **só pedido PAGO** (RN-001, `OrderItem` de
  `PAID_ORDER_STATUSES`, data = `paidAt` ou, sem ela, `createdAt`);
  **cobertura** = disponível ÷ vendas por dia, em dias inteiros — sem venda
  no período é "sem venda", nunca "infinito"; item vendido SEM peça no
  cadastro (produto apagado, SKU da Nuvemshop que não casou) fica fora do
  giro e a tela DIZ quantos; a última venda é procurada em UM ANO (pelo
  índice de `paidAt` — a loja de cinco anos não varre a história inteira a
  cada abertura), e "sem venda há mais de 1 ano" é dito assim; **encalhada**
  = tem peça DISPONÍVEL (a reservada tem dono) e não vende há 60 dias — para
  quem nunca vendeu, os 60 dias contam do CADASTRO (a coleção que entrou na
  segunda não é "encalhada" na terça) —, com o valor parado **a CUSTO**
  (`costPrice` — é o dinheiro que a loja gastou; a atacado seria dinheiro
  que ela ainda não recebeu); **o que repor** = chegou ao mínimo (RN-051),
  e a sugestão cobre 30 dias no ritmo atual, **nunca menos que voltar ao
  DOBRO do mínimo** (repor só até o mínimo faria a peça alertar de novo na
  primeira venda). Peça de dono externo (RN-050) não entra em "repor" — quem
  repõe lá é a loja online. Giro % = vendidos ÷ (disponível + vendidos) — a
  peça paga esperando envio já está em "vendidos". Listas com teto (repor e
  encalhadas 30, mais vendidas 10) e "por categoria" com peças, valor a
  custo, vendidas, no mínimo e encalhadas. A montagem é pura
  (`resumirPainel`) e testada. A **aba Produção**
  (só com `productionEnabled`) responde o que o Inventário não responde na
  confecção — cortado esperando costura (`SewingItem.cutPieces − donePieces`),
  em lote de costura (TODO lote não fechado, facção e costura interna,
  `sent − good − defect` — enviar para a costura interna também consome o
  cortado) e tecido para cortar (rolo de tecido ATIVO com sobra — a MESMA
  lista da tela Cortes, conferida lado a lado; valor pelo preço pago por kg)
  — e **não
  grava nada**: o caminho "cortado vira produto" continua sendo a tela
  Costura (`lancaNoEstoque`, que sobe o estoque, escreve a ENTRADA no livro
  e espelha para a Nuvemshop); a aba só dá o atalho. Balanço e IA ficaram
  fora por decisão do dono.
  **OS NÚMEROS BATEM COM AS OUTRAS TELAS — e existe um script que prova**
  (`scripts/confere-numeros-estoque.ts`, pergunta do dono em 09/09/2026):
  ele roda a conta de CADA tela lado a lado sobre os mesmos dados — Estoque ×
  Costura, Lotes e Cortes; reservado × ficha de cada pedido (o livro); "no
  mínimo" nas quatro telas e no sino; giro × a régua de venda paga (RN-001);
  "na loja"/"disponível" × as "un." da tela Produtos. Achou duas divergências
  na primeira rodada (o filtro dos rolos cortava em 0,01 kg e a tela Cortes
  mostra qualquer sobra) — por isso ele fica. **A única diferença que
  PERMANECE é de propósito e está dita na tela**: a tela Produtos mostra o
  DISPONÍVEL ("20 un.") e o Estoque mostra também o reservado ("na loja" =
  disponível + reservado); e a ficha do pedido só exibe a faixa de "peças
  reservadas" enquanto o pedido não foi pago (ali o aviso é "cancele para
  liberar"), embora o Estoque conte como reservada toda peça de pedido que
  ainda não saiu da loja.
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
  `/financeiro/dfc`; `lib/financeiro/painel.ts` e `saude.ts` desde 05/09/2026):
  a tela do Financeiro é o PAINEL DE DONO — saldo em caixa hoje (somado por
  conta), o **saldo previsto** em 30, 60 e 90 dias com o termômetro de
  cobertura, a **curva dia a dia** (fluxo de caixa projetado, com o dia mais
  apertado marcado quando fica negativo), a **nota de saúde** (0–100), o
  **resumo do mês** (entrou, saiu, resultado e ticket médio) e **para onde foi
  o dinheiro** (saídas do mês por categoria). Redesenho pedido pelo dono em
  05/09/2026 ("mais relevante e bonito"), com estas réguas: a previsão soma só o
  que está EM ABERTO (o já pago não pode contar duas vezes) e **o atrasado
  ENTRA** — a conta vencida ontem continua sendo dinheiro a receber, e tirá-la
  faria a loja se planejar com menos do que tem; na curva ele **cai em HOJE**
  (`GREATEST(vencimento, hoje)`); a consulta (`linhasDaCurva`) e a montagem
  (`montarCurva`, pura e testada) são separadas, e o ponta a ponta confere o
  último ponto contra a soma em aberto feita direto no banco. O **saldo de hoje
  tem UM caminho**: somado por conta, e a curva PARTE dele. O **resumo do mês
  compara com o MESMO trecho do mês anterior** (dia 1 até o dia de hoje;
  fevereiro para no último) — comparar o dia 5 com o mês passado inteiro
  diria "caiu 80%" toda virada de mês; entrou/saiu seguem a régua do extrato
  (baixa viva, lançamento não cancelado, valor − desconto + juros), o
  **ticket médio é pelo valor VENDIDO** (`netTotal`, RN-002) de pedido pago
  (RN-001), e o **resultado não tem variação %** (negativo dos dois lados
  confunde — mostra o valor anterior). A **nota de saúde** (`avaliarSaude`,
  pura) é a soma de QUATRO sinais de 25 pontos, cada um com frase em
  português dizendo o que mediu e o caminho: o saldo cobre o que vence em 7
  dias?; saldo + a receber cobrem o que sai em 30?; quanto do que há para
  receber já venceu? (medido como PARTE, não em reais — R$ 250 atrasados é
  pouco para quem tem R$ 6 mil a receber e grave para quem tem R$ 600); no
  mês entrou mais do que saiu? Nota sem explicação é adivinhação com cara de
  ciência. "Para onde foi o dinheiro" agrupa pela categoria que a lojista
  escolheu (não pela raiz da árvore — "Aluguel" diz mais que
  "Administrativas"), as 5 maiores com nome e o resto em "Outras" (cinza de
  propósito; a paleta das fatias foi validada para daltonismo). As ações do
  dia trazem número honesto (clientes atrasados, linhas do extrato do banco
  sem par — a MESMA conta e a MESMA janela que a tela de conferir abre, senão
  o botão diz 12 e a tela mostra 3 —, o que vence hoje, levando para o lado
  que tem valor). O **DFC** responde "por onde o
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
  no menu (`/envios`): painel (gasto do mês, frete recebido no mês — RN-065,
  abaixo —, aguardando postagem, em
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
  **RN-065 · FRETE RECEBIDO NO MÊS, E O SALDO COMPARA OS MESMOS PEDIDOS**
  (`resumoDosEnvios` em `lib/envios/painel.ts`, 23/09/2026): pedido do dono
  — *"temos o gasto com frete no mês, que é das etiquetas; queria o quanto
  recebi de frete, o que colocamos no campo de frete do pedido"*. O cartão
  soma o campo de frete (`Order.shippingFee`) dos pedidos **PAGOS** (RN-001)
  pela **data do pagamento** (a régua do faturamento), no recorte de quem
  vê (RN-007), **todos os canais** — a loja online também cobrou frete; soma
  `shippingFee`, **nunca `total`** (RN-002), e "N pedidos" conta só quem
  cobrou frete (retirada e motoboy por fora ficam de fora). **O saldo NÃO é
  "recebido − gasto do mês"** (achado da revisão): são populações
  diferentes — o gasto conta etiquetas COMPRADAS no mês, de pedido em
  qualquer status (RN-022); pedido pago dia 30 com etiqueta comprada dia 1º
  virava "faltou R$ 35" em vermelho num frete coberto, e pedido da Nuvemshop
  (frete cobrado lá, etiqueta comprada lá) inflava a sobra. O saldo compara,
  **dentro dos pedidos pagos do mês, só os que têm etiqueta comprada aqui**
  (não cancelada): frete cobrado neles − custo dessas etiquetas — a mesma
  turma dos dois lados, e frete zero ENTRA nessa turma (a loja mandou de
  graça e pagou etiqueta). Sem pedido com etiqueta, não há saldo (null, não
  zero), e a legenda diz só quantos cobraram frete. A rota está na varredura
  de dinheiro (`faturamento-data.test.ts`), e o número foi conferido contra
  a soma direta no Postgres local.
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
  **RN-054 · A NATUREZA DE OPERAÇÃO DA NOTA SEGUE O DOCUMENTO DA CLIENTE**
  (`lib/nfe-natureza.ts`, 11/09/2026): relato do dono ao montar a integração do Bling — a natureza
  padrão da conta dele é *"Venda de mercadoria a não contribuinte"* e o
  sistema não mandava natureza NENHUMA, então TODA nota sairia por essa. Só
  que a loja de atacado vende para os dois públicos: a lojista que compra com
  **CPF** (a maioria, segundo o dono) é consumidora final e "não
  contribuinte" está certo para ela; a que compra com **CNPJ e inscrição
  estadual** é CONTRIBUINTE de ICMS, com outro CFOP e outro tratamento de
  imposto. Natureza errada não é defeito de tela: é **documento fiscal
  emitido errado**, que a loja responde perante o fisco. Por isso quem decide
  é o DOCUMENTO de quem compra, nota a nota. **Contribuinte exige CNPJ E
  inscrição estadual** — só o CNPJ não basta, porque existe CNPJ isento de IE
  (prestador de serviço, MEI) que compra como consumidor final; na dúvida cai
  em NÃO CONTRIBUINTE, que é o caso da maioria e o que já acontecia. **Os
  números são do CONTADOR**: a loja cadastra em Configurações → Bling qual
  natureza vale para cada caso (as que existem no Bling dela) e o sistema só
  escolhe entre elas — nunca inventa. **Loja que não configurar nada não muda
  em NADA**: sem natureza cadastrada o campo não vai na nota e o Bling usa a
  padrão da conta, exatamente como antes. E a ficha **DIZ antes de emitir** em
  que natureza a nota vai sair e por quê (`explicarNatureza`): nota fiscal não
  se desfaz com um clique — cancelar tem prazo e deixa rastro —, então o erro
  tem que aparecer ANTES. A natureza viaja como **`naturezaOperacao: { id }`**
  (o Bling recebe o ID, não o nome — confirmado na documentação da API v3), e
  junto vão dois campos que o sistema NUNCA mandou: a **inscrição estadual**
  (só de quem é contribuinte — IE solta numa ficha de CPF confundiria o fisco
  sobre o tipo da venda) e o **`contribuinte`** (1 ou 9). Mas o `contribuinte`
  **só é afirmado quando a ficha DAQUI prova** (`contribuinteParaNota`): CNPJ
  com IE sai 1, CPF sai 9 e **CNPJ sem IE aqui não manda o campo** — a IE pode
  existir só no cadastro do Bling, e carimbar 9 sobrescreveria aquilo,
  emitindo uma venda B2B como consumidor final, com o CFOP errado, numa nota
  que não se desfaz (achado da revisão). Os ids das naturezas são guardados
  como TEXTO, como todo id do Bling: os de lá passam de 10 dígitos e
  estouravam o Int de 32 bits.
  **RN-055 · A INFORMAÇÃO FISCAL DA PEÇA MORA AQUI, E VAI NA NOTA**
  (`lib/fiscal-ncm.ts`, 11/09/2026): relato
  do dono montando o Bling — *"não quero ter que cadastrar manualmente lá
  sendo que já tenho tudo aqui"*. Ele estava certo, e a documentação do Bling
  deu a saída: o item da nota aceita **`classificacaoFiscal`** (o NCM) e
  **`origem`**. Mandando os dois, a nota sai completa daqui e **a loja não
  precisa manter um segundo catálogo no Bling** — que era o trabalho que fazia
  a integração não valer a pena. O NCM é do TIPO da peça, não de cada cor ×
  tamanho: uma confecção tem dezenas de modelos e 5 a 15 tipos, então a régua
  é a MESMA da RN-051 e pelo mesmo motivo — **peça (exceção) > CATEGORIA (o
  normal) > loja**. O degrau da LOJA existe para o atacado que vende um tipo
  só (só regata, só moda praia): cadastra um número e acabou. **Os números são
  do CONTADOR**: o sistema não inventa NCM, não deduz pelo nome da peça e não
  tem lista embutida — NCM errado é imposto errado e quem responde é a loja.
  Só 8 dígitos passam (nem 7 nem 9: número curto passaria na nossa tela para
  morrer na SEFAZ) e o campo sai **com os pontos**, como no exemplo da API.
  Degrau com número inválido é PULADO, não derruba a conta. Sem NCM o campo
  **não vai** (a nota tenta pelo cadastro do Bling, como antes), mas a ficha
  **AVISA antes de emitir**, dizendo quantas peças faltam e mandando cadastrar
  a CATEGORIA — não peça por peça. A **origem** (0 = nacional, o caso da
  confecção brasileira) é configurável por loja porque quem revende importado
  tem outro código; valor fora da tabela da Receita (0 a 8) cai no nacional em
  vez de ir torto para a nota.
  **RN-058 · Nota RECUSADA volta a ter caminho — e AUTORIZADA nunca**
  (`lib/nfe-situacao.ts`, 16/09/2026): relato do dono — *"uma nota foi
  rejeitada, aí atualizei os dados com a inscrição estadual; como faço para
  tentar reemitir?"*. **Não era falta de permissão**: o servidor já aceitava
  (a trava de `emitirNfeDoPedido` deixa passar REJEITADA e CANCELADA, e a
  própria mensagem de erro dele mandava *"clique em emitir de novo"*) — a
  TELA é que mostrava o selo da nota **OU** o botão, nunca os dois. Beco sem
  saída: a ficha anunciava o problema e escondia o conserto. A régua é a do
  fisco: **AUTORIZADA nunca** (a nota vale, e outra seria nota em dobro — o
  caminho é cancelar no Bling, com prazo curto); **REJEITADA e CANCELADA
  sempre** (perante o fisco elas não existem e o pedido PRECISA de nota);
  **EMITINDO e situação desconhecida** do Bling caem no lado seguro, porque
  o estrago aqui é documento em dobro. **Uma régua só para as duas portas**:
  a ficha do pedido e o Financeiro (RN-038), que mantinha conta própria
  (`!== "AUTORIZADA"`) e por isso oferecia emitir com a nota EMITINDO.
  **O caminho de ERRO é diferente e a tela DIZ**: `retomarNfeComErro`
  **retransmite o rascunho que já está no Bling** (não faz PUT no payload),
  então ele NÃO incorpora correção feita no cadastro depois — por isso
  `remontaNota: false`, e a ficha não promete ali a natureza/NCM novos.
  Prometer seria mentira sobre documento fiscal (achado da revisão): a
  lojista cadastraria a IE, leria "vai sair como contribuinte" e a SEFAZ
  autorizaria com os dados antigos. Quem corrigiu o cadastro passa por ele
  assim mesmo — a retomada descobre que a anterior foi recusada, o pedido
  volta a REJEITADA e AÍ a nota nasce do zero, com o cadastro de agora. O
  aviso da RN-054/RN-055 acompanha o BOTÃO, não a ausência de nota: é na
  reemissão que conferir a natureza importa mais, porque foi justamente
  cadastrar a inscrição estadual que transformou a compradora em
  contribuinte. E a ficha **recarrega mesmo quando a emissão falha**: a falha
  também muda o status (REJEITADA vira ERRO com id novo; ERRO vira REJEITADA
  com id nulo), e sem isso o clique seguinte fazia coisa diferente do que o
  texto prometia.
  **E a LISTA de pedidos mostra a nota** (`seloDaNota`/`precisaDeNota`,
  16/09/2026): selo com o **número** da nota autorizada — *"uma caixa no canto
  que diz NF e o número"* — e, em vermelho, a que deu errado. O número
  autorizado é conferência; a **recusada é PROBLEMA** (pedido pago sem nota é
  pendência fiscal) e só aparecia abrindo pedido por pedido: é onde o selo
  vale mais. A recusada **nunca mostra o número** (ele existe no banco, mas
  anunciá-lo faria a loja achar que tem nota), e pedido sem nota **não ganha
  selo** — marcar ausência em 98 linhas polui a lista para não dizer nada.
  O chip **"Falta nota"** é a fila: **pago (RN-001) e sem nota AUTORIZADA**;
  orçamento e aguardando pagamento ficam fora (a emissão os recusa antes de
  pago) e cancelado não precisa de nota. **EMITINDO fica DENTRO** de
  propósito — tirá-la sumiria com a emissão travada, e pedido pago sem nota
  escondido é pior que uma linha a mais. Só aparece para gerência (a régua da
  ficha) **e com o Bling conectado**: sem ele a loja nunca emite e a fila
  seria a lista inteira. A cláusula do banco mora **colada** na função pura
  (`ONDE_FALTA_NOTA`), porque são duas escritas da mesma regra, e
  `scripts/confere-fila-nota.ts` prova contra o Postgres que concordam nas 48
  combinações. **O `OR` dela não é estilo**: `nfeStatus != 'AUTORIZADA'` NÃO
  devolve quem está NULO em SQL — e nulo é quem nunca emitiu, a maioria da
  fila; medido, ela mostrava 20 de 25 e escondia justamente esses. Com a fila
  ligada, **TODAS as contagens da tela entram nela** (`comFila`, irmão do
  `comCampanha`): o chip que somava a loja inteira dizia 58 e abria 2, e a
  paginação prometia páginas vazias (achados da revisão).
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
- 🟡 **Módulo Estoque — preço de tabela a definir pelo dono** (09/09/2026):
  está 0 no catálogo (`lib/modulos.ts`), então ligar o módulo numa loja NÃO
  soma no MRR. Quando o Atos disser o valor, trocar o número e o teste
  `estoque-minimos.test.ts` que o fixa.
- 🟡 **BI de vendas do WhatsApp — em construção** (ADR-019, 13/10/2026):
  módulo novo com chave liga/desliga, para as lojas da assessoria de
  processo comercial (preço a definir). **Fase 0 (instrumentação, coleta
  para TODAS as lojas)**: horário de atendimento (RN-079 ✅), marca de
  mensagem automática + conta pura do tempo de resposta (RN-080 ✅), motivo
  de perda com lista fixa (RN-081 ✅) — **Fase 0 concluída**. **Fase 1 ✅
  (RN-082, 14/10/2026)**: módulo com chave, fatos diários de carona (sem
  cron) e o painel do dono em `/bi` (leads/dia, resposta no prazo, funil por
  fatos, vendas × meta, metas personalizáveis). **Pendente do dono**: o
  preço de tabela (0 no catálogo) e ligar a chave nas lojas da assessoria.
  **Fase 2a ✅ (RN-083, 14/10/2026)**: aba Vendedoras (fatos por pessoa).
  **Fase 2b ✅ (RN-084, 14/10/2026)**: aba Clientes (a carteira da Recompra
  em R × F × M). **Fase 2c ✅ (RN-085, 14/10/2026)**: aba Anúncios (gasto
  por mês × contatos × vendas) — **Fase 2 concluída**. **Fase 3 ("completo
  e dinâmico", ordem aceita pelo dono em 14/10/2026)**: clicar e cavar
  (RN-086 ✅) → linha de 12 meses (RN-087 ✅) → faixa "hoje" viva (RN-088
  ✅) → visual (RN-089 ✅) → exportar PDF (RN-090 ✅); depois, benchmark entre lojas (Super Admin) e resumo semanal no
  WhatsApp do dono. **RFM (pedido do dono, 22/10/2026)**: Etapa 1 ✅
  (RN-093, 23/10/2026: notas, oito grupos, matriz e o Chamar na aba
  Clientes); Etapa 2 ✅ (RN-098, 27/10/2026: grupo no filtro das campanhas,
  gerência); Etapa 3 ✅ (RN-100, 27/10/2026: tarefa para a dona quando a
  cliente cai para um grupo de alerta); Etapa 4 ✅ (RN-101, 27/10/2026: o
  retrato do mês — quem caiu, subiu e chegou) — **RFM concluído**. **Modo TV adiado** pelo dono. Decisões do dono: só gerência
  vê; origem do lead segue automática (sem marcação manual); metas de
  qualquer tipo, a loja escolhe; prazo dentro do horário comercial.
- 🟡 **Calendário comercial — preço de tabela a definir pelo dono**
  (RN-092, 23/10/2026): está 0 no catálogo (`lib/modulos.ts`), então ligar o
  módulo numa loja NÃO soma no MRR. Quando o Atos disser o valor, trocar o
  número e o teste `calendario-comercial.test.ts` que o fixa. A lista de
  segmentos e datas de oportunidade (`lib/calendario/datas.ts`) foi montada
  para o dono revisar.
- 🟡 **Tela branca na abertura (RN-095, 23/10/2026)**: a tela muda virou
  aviso com botão, e o painel de Saúde passou a CONTAR as aberturas que não
  terminam (bloco "Telas que não terminaram de carregar"). A causa de rede
  das duas clientes segue em aberto — olhar esse bloco na semana seguinte à
  entrega (qual loja, qual navegador, com ou sem internet). Próximo passo
  possível, não feito: no celular o cabeçalho (`md:hidden`) chega DEPOIS do
  menu lateral de computador no HTML (`app-shell.tsx`), então a primeira
  coisa visível só vem a ~25% do arquivo; desenhar o cabeçalho do celular
  antes do menu traria o primeiro pixel para ~5% (mexe na ordem de foco do
  teclado no computador — decidir antes). Botões do dono na Vercel:
  Firewall (modo "challenge" barra o navegador de dentro do WhatsApp) e Skew
  Protection (RN-066).
- WhatsApp/Evolution: operacional em produção (conexão, tempo real, mídia).
  **Pendente**: ligar `DATABASE_SAVE_DATA_HISTORIC/NEW_MESSAGE/CHATS/CONTACTS=true`
  no compose do servidor Evolution (Hostinger, via Editor .yaml) e reconectar
  as lojas — sem isso a importação de histórico devolve ~0 mensagens.
- **Monitoramento** (25/07/2026): vigia em `lib/health.ts` roda de carona no
  tráfego (SEM cron novo!) — checa servidor Evolution + conexão por loja,
  alerta sino/push com anti-spam; erros de produção capturados por
  `src/instrumentation.ts` (onRequestError) → painel `/saude` (Super Admin).
  **Velocidade das telas** (22/10/2026, relato do dono: *"clico numa tela
  pelo celular e demora uns 3 segundos"*): medido contra o Postgres local
  com atraso de rede simulado, o tempo de uma tela é quase só (idas ao banco
  EM FILA) × (quanto custa UMA ida) — com o servidor e o banco em regiões
  diferentes, ~120 ms cada; na mesma, 1–2 ms. O painel `/saude` mede e DIZ
  (`lib/velocidade-do-banco.ts`): região do servidor (`VERCEL_REGION`),
  região do banco (lida do endereço — só região e bandeiras, nunca o
  segredo), o tempo de uma ida e o conselho; `pgbouncer=true` no endereço é
  alarme próprio (o Prisma faz BEGIN/DEALLOCATE/COMMIT em volta de CADA
  consulta: 5 idas em vez de 1, medido). Do lado do código: as regras do
  "quem chamar hoje" (`computeAutomations`) consultam juntas, e o toque no
  menu mostra NA HORA a barrinha cobre no topo (`sinal-de-navegacao.tsx`,
  `useLinkStatus`) — sem ela a tela parecia travada e a pessoa tocava de novo.
- **Dinheiro** (25/07/2026): Mercado Pago marketplace (Pix com confirmação
  automática via `lib/settle-order.ts`; taxa da plataforma 0,5% em
  `PLATFORM_FEE_PCT`/`feePercent` por loja), tela Financeiro (contas a
  receber) e NF-e via Bling (`lib/bling.ts`). PENDENTE para produção:
  criar app no Mercado Pago (envs `MP_CLIENT_ID`/`MP_CLIENT_SECRET`) na Vercel.
- **Bling / NF-e** (14/09/2026): **EM PRODUÇÃO** — app criado, envs na Vercel,
  Toque Leve conectada e **primeira NF-e autorizada**. Três coisas que
  custaram caro para descobrir e não podem se perder: (1) as chamadas de API
  vão para **`api.bling.com.br`** — o `www` é bloqueado para API e responde
  "Acesso não permitido", enquanto a tela de autorização e a troca de token
  seguem no `www` (por isso a loja conecta, o cartão diz "Conectado" e SÓ a
  emissão falha); (2) **mexer nos escopos do aplicativo REVOGA a autorização
  já concedida** — depois de qualquer mudança lá, é obrigatório Desconectar e
  Conectar; (3) o escopo que a emissão exige é **"Emissão de Nota Fiscal
  Eletrônica (NF-e)"**, dentro de "Notas Fiscais". A recusa do Bling chega
  inteira na tela (status HTTP, descrição e campo) e a resposta crua fica no
  painel de Saúde: foi a falta disso que transformou um endereço errado em
  três tentativas de conserto no escuro.
- **Envios** (13/08/2026): Melhor Envio **em produção** — app criado, envs na
  Vercel, primeira conta conectada e cotando. Parceria/comissão ME em
  negociação à parte. A etiqueta com NF-e (RN-016) já pode sair com a chave.
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
