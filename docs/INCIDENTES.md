# Incidentes reais e as regras que nasceram deles

Este documento existe por um motivo simples: **quase toda regra estranha deste
código foi escrita com sangue.** Se você achar uma verificação que parece
paranoia, um teste que parece exagero ou uma trava que parece burocracia,
provavelmente ela está aqui — com a data, a loja e o prejuízo.

Leia antes de "simplificar" alguma coisa.

Cada caso segue o mesmo formato:

> **O que a loja viu** → **A causa** → **O conserto** → **A regra que ficou**

---

## 💰 Dinheiro

### 1. O Dashboard contava frete como venda (28/07/2026)

**O que a loja viu.** Nada — e esse é o ponto. Os números batiam com eles
mesmos, só estavam todos inflados. Dava para **bater a meta do mês com frete**.

**A causa.** O Dashboard somava `Order.total` (que inclui frete) onde a regra
manda somar `netTotal` (o valor vendido). Uma auditoria externa apontou 6
pontos; conferindo linha a linha eram **11 ocorrências** e mais 2 defeitos que
nem a auditoria tinha visto: o ranking de melhores clientes somava `netTotal`
mas **ordenava por `total`** (a ordem saía trocada), e a mesma tela mostrava
**dois ticket médio diferentes**, um de cada campo.

E o pior: **o guarda existia e passava.** O teste `faturamento-data.test.ts`
vigiava o Dashboard, mas a busca dele era estreita demais — procurava
`_sum: { total: true }` e um formato de `reduce` que sequer casava com o código
real. Os cinco padrões usados no Dashboard: nenhum era detectado.

**O conserto.** O guarda passou a fazer varredura **ampla** (`_sum`, `select`,
`orderBy` e qualquer soma de `.total`), e o uso legítimo virou **explícito**:
quem precisa de `total` declara o marcador `frete-ok` com o motivo. Os pontos
marcados assim são os do Financeiro — contas a receber **é** o que a cliente
paga, com frete.

**A regra que ficou.**
- Faturamento soma `netTotal`. Sempre. `total` só para cobrar.
- Uso legítimo de `total` se declara com `frete-ok` e o motivo, na linha ou nas
  duas acima.
- **Guarda que não pega nada é pior que guarda nenhum** — ele dá falsa
  segurança. Ao escrever um teste de varredura, prove que ele pega o defeito
  que você acabou de consertar (quebre o código de propósito e veja falhar).

📌 Teste: `src/lib/__tests__/faturamento-data.test.ts`

---

### 2. A revisão que achou 10 bugs num código "pronto" (09/08/2026)

**O que aconteceu.** A conferência de tarefas estava pronta, testada e prestes a
subir. A revisão especialista achou **10 bugs** — **3 deles escondiam dinheiro
pendente** da loja.

**A causa.** Não foi descuido. Foram casos de canto: dois pedidos ao mesmo
tempo, compromisso marcado para o futuro, status raro. É exatamente o que o
autor de um código **não enxerga** — ele está com a cabeça no caminho feliz que
acabou de construir.

**A regra que ficou.** Revisão especialista (`/code-review`, nível **high**) é
obrigatória antes de **todo** push. Corrige os achados confirmados e só então
sobe. Exceção: mudança trivial sem lógica (texto, cor, label).

E mais: quando a mudança mexe com **dinheiro, estoque ou algo que apaga/conclui
dado sozinho**, além da revisão, reproduza o cenário **ponta a ponta** contra o
Postgres local antes de subir. Adivinhar já errou três vezes num único dia.

---

## 📦 Pedido e estoque

### 3. O pedido do catálogo que sumia (28/07/2026 — loja Entre Linhas)

**O que a loja viu.** A cliente montou o pedido no catálogo. A mensagem chegou
no WhatsApp da vendedora, certinha. **O pedido nunca apareceu no sistema.**

**A causa.** O catálogo disparava o registro no servidor, abria o WhatsApp na
mesma hora e **engolia qualquer erro**:

```js
.catch(() => {})   // ← a venda sumia aqui
```

Um tropeço de internet no momento do envio fazia a venda desaparecer — sem
aviso para a cliente, para a loja ou para nós.

**O conserto.** Cinco camadas:

1. **Protocolo de envio** (`Order.clientRef`, único por loja): o aparelho da
   cliente sorteia o código e **guarda o pedido ANTES de mandar**.
2. **Insistência**: 4 tentativas com intervalo crescente; se ainda assim não
   for, o pedido fica guardado no aparelho e é **reenviado na próxima visita**.
3. **Insistir é seguro**: a rota é idempotente — devolve o pedido que já existe
   em vez de criar outro; a corrida (envios simultâneos) cai no índice único e é
   tratada (P2002). Uma venda, um pedido, uma baixa de estoque.
4. **A cliente vê o recibo**: "Pedido registrado" ou, na falha, o aviso para
   confirmar pelo WhatsApp.
5. **Avisa na hora** (sino + push): com vendedora no link, só ela; sem
   vendedora, gerência/admin. Antes não avisava ninguém — só era descoberto se
   alguém abrisse a tela Pedidos.

Verificado ao vivo: internet derrubada no envio → pedido guardado no aparelho
com aviso na tela → internet de volta → catálogo reaberto → venda recuperada.

**A regra que ficou.** **Nunca engula erro com `.catch(() => {})`.** Se a
operação importa, ela precisa de protocolo, insistência e recibo. Se não
importa, por que ela existe?

📌 Testes: `envio-pedido.test.ts`, `pedido-nao-duplica.test.ts`,
`aviso-reenvio-sobrevive.test.ts`
📌 Código: `src/lib/catalogo/envio-pedido.ts`

---

### 4. O pedido de 31 peças que morria no meio (28/07/2026)

**O que a loja viu.** "Não foi possível criar o pedido." Só isso. O pedido lia
certo — 29 linhas, R$ 803,10 — e morria.

**A causa.** A reserva de estoque fazia **um comando por peça**. No banco local
isso é instantâneo; em produção o banco está na nuvem e cada comando é uma
viagem de ida e volta. Um pedido de 29 linhas virava ~30 viagens **dentro da
transação** — e a transação do Prisma tem **5 segundos de limite por padrão**,
que ninguém tinha configurado. Estourava ali, a rota morria sem resposta.

**O conserto.** A reserva passou a ir num comando só, para qualquer tamanho de
pedido — com a condição "estoque >= pedido" ainda **dentro** do comando, linha
por linha, para o banco continuar garantindo que duas vendas simultâneas da
última peça não passem as duas. Limites explícitos: 20s de transação, 60s de
função.

Achado de brinde: **a mesma peça repetida em duas linhas** não era somada antes
da conferência — duas linhas de 1 peça passavam com 1 em estoque. Acontece de
verdade no pedido colado do WhatsApp.

**A regra que ficou.** Latência de rede não aparece em dev. Toda operação em
lote precisa ser **um comando**, não N. E transação sem limite explícito usa o
default de 5s — que é pouco.

📌 Teste: `pedidos-blindados.test.ts`, `reservations.test.ts`

---

### 5. A reserva de 48h que soltava a peça no meio da negociação

**O que a loja viu.** A cliente pediu na terça e ia pagar na sexta. Na
quinta-feira, a peça tinha voltado sozinha para o catálogo e sido vendida para
outra pessoa.

**A causa.** Havia uma soltura automática de estoque em 48 horas. Faz sentido
no varejo. **No atacado, não** — o ciclo é de dias.

**O conserto.** A soltura automática foi **removida do produto**. A peça só volta
ao estoque quando o pedido é **CANCELADO**.

**A regra que ficou.** A reserva **não tem prazo**. Se alguém reintroduzir
qualquer expiração por tempo, o teste quebra — ele varre o código atrás disso de
propósito.

📌 Teste: `reserva-sem-prazo.test.ts` (leia o comentário do topo)

---

### 6. Cancelar nem sempre devolve a peça (10/08/2026)

**O que a loja pediu.** Cancelar um pedido **sempre** devolvia as peças ao
catálogo. Mas nem sempre elas voltam de verdade: perda, defeito, brinde,
cliente que ficou com a mercadoria.

**O conserto.** Ao cancelar, a vendedora escolhe:
- **Devolver ao estoque** (padrão) — o livro de movimentos devolve **exatamente
  o que aquele pedido segurou**;
- **Baixa definitiva** — nada volta, e a decisão fica registrada no histórico
  com o nome de quem decidiu (`Order.stockWrittenOff`).

**A regra difícil — reabrir.** Pedido cancelado com baixa definitiva que volta à
ativa **NÃO desconta o estoque de novo**. Se descontasse, o líquido do livro
ficaria negativo e um cancelamento posterior devolveria peça que nunca saiu.
Baixa definitiva e reanexação também **não são empurradas às integrações** —
elas não mudam estoque local.

📌 Código: `resolveCancelStock` / `resolveReopenStock` em `src/lib/orders.ts`
📌 Teste: `cancel-stock.test.ts`

---

### 7. O pedido do link da Lara caindo no painel da Juliana

**O que a loja viu.** A vendedora Lara mandou o link do catálogo dela para uma
cliente. A cliente pediu. O pedido — e a comissão — apareceu no painel da
Juliana, que era a "responsável pela cliente" no cadastro.

**A causa.** Existia um desvio: sem vendedora identificada, o pedido ia para a
dona da carteira do cliente. Parecia justo. Na prática roubava a venda de quem
trabalhou.

**O conserto.**
- Pedido do catálogo **com** `?ref=`: é de **quem mandou o link, e só dele** — e
  a carteira acompanha (`Customer.ownerId` passa a ser dela, com registro na
  linha do tempo).
- Pedido do catálogo **sem** `?ref=`: nasce **sem dona** (é da loja). Não existe
  mais desvio para a responsável pela cliente.
- Nuvemshop: sem vendedor.
- Pedido só vira **PAGO** com vendedor definido — é o que obriga a loja a
  resolver a dona antes de faturar. Troca de vendedor é auditada em `OrderEvent`.

**A regra que ficou.** Quem mandou o link leva a venda. A mesma separação vale
para o **aviso**: sem vendedora no link, avisa gerência/admin — nunca uma
vendedora qualquer.

📌 Testes: `comissao-link.test.ts`, `transferir-venda.test.ts`,
`scope-pedidos.test.ts`

---

## 💬 WhatsApp

### 8. "Já respondi esse cliente e aparece como se eu nunca tivesse conversado" (29/07/2026)

**O que a loja viu.** O cabeçalho da conversa dizia "aguardando cliente há 6min"
— ou seja, **o sistema sabia da resposta** — e a conversa mostrava só a mensagem
da cliente. O histórico só voltava recarregando a página inteira.

**A causa.** O sync incremental (a cada 3s) traz só **o que mudou**. Para quem já
tem a conversa na tela isso funciona: a tela junta com o que tinha. Mas a
conversa que **chega por ele** entra só com o pedaço que veio — e esse é o caso
comum em loja movimentada: a carga inicial traz 200 conversas, a cliente
escreve numa conversa mais antiga, e ela reaparece com uma mensagem só.

Reproduzido antes de corrigir: conversa com 6 mensagens no banco, o sync
devolvendo 1.

**O conserto.** A tela guarda quais conversas já tem com histórico
(`threadsCarregadas`); quando o sync entrega uma que ela não conhece, busca a
conversa inteira em `GET /api/conversations/[id]`. O que veio na carga inicial
não é buscado de novo — o ganho de velocidade continua de pé.

Mais duas portas fecharam o resto do buraco:
- `GET /api/conversations/[id]/mensagens?antes=` — "Ver mensagens anteriores".
  **Sem ela o começo da conversa era literalmente inacessível.**
- `GET /api/conversations?q=` — busca na loja inteira. Sem ela, a lupa só
  enxergava as 200 conversas já carregadas.

**A regra que ficou.** **O que o sync entrega é PARCIAL.** Nunca trate a
resposta do sync como a conversa completa.

📌 Testes: `inbox-sincronia.test.ts`, `inbox-auditoria.test.ts`,
`nenhuma-mensagem-some.test.ts`, `busca.test.ts`

---

### 9. A tela que não aguentaria a loja crescer (29/07/2026)

**O problema previsto.** Uma loja real chegou a 2.007 conversas e 120 mil
mensagens. A lista carregava tudo de cada conversa — e um pedido de catálogo tem
milhares de caracteres.

**O conserto.** A lista carrega só a **última mensagem** de cada conversa,
cortada em 140 caracteres. O histórico vem ao **abrir** a conversa. A tela
desenha em blocos de 200 linhas, mas guarda a lista **inteira** em memória — é
o que faz a contagem das abas e a busca serem verdadeiras.

**Medido, não estimado:** 4,5 MB com 200 conversas visíveis → **1,75 MB com
todas visíveis**.

**A regra que ficou.** Quando o assunto é escala, **meça**. O commit se chama
"preparado para milhares de conversas (medido, não estimado)" de propósito.

---

## 🔒 Segurança

### 10. XSS guardado na bio pública + portas de entrada abertas (08/08/2026)

Dois achados de uma auditoria, corrigidos como hotfix.

**XSS armazenado na bio.** Os campos `metaPixelId` e `gaId` eram interpolados
**crus** dentro de um `<Script>` na página que a **cliente final** abre. Um
gerente — ou um Super Admin impersonando — podia gravar
`x');alert(...);('` e executar JavaScript arbitrário em produção.

Conserto em duas pontas: `lib/pixel-id.ts` valida na **gravação** (regex de id
de verdade no schema da API) e **higieniza na exibição** (só passa o formato
válido; lixo já gravado vira `null` e o script nem renderiza).

**Rotas de intake fail-open.** `/api/intake/[channel]` e o formato simulado de
`/api/whatsapp/webhook` só exigiam token **se** `INTAKE_SECRET` estivesse
definida:

```ts
if (secret && tokenInvalido) return 401;   // ← sem a env, ninguém confere nada
```

Sem a variável configurada, as rotas ficavam **abertas**: qualquer pessoa que
soubesse o slug da loja — que é público, aparece no link do catálogo — criava
lead, conversa e tarefa dentro dela.

Agora é **fail-closed**: sem `INTAKE_SECRET`, respondem 503.

**A regra que ficou.** Verificação de segurança **nunca** é condicional à
existência da configuração. Sem a chave, a porta fecha — não abre.

📌 Teste: `seguranca-lote0.test.ts`
📌 Ver também `escopo-apis-lote1.test.ts` — "trancar as portas dos fundos",
APIs que não filtravam por papel/carteira.

---

## 🚀 Infraestrutura e deploy

### 11. O terceiro cron que bloqueia todos os deploys, sem avisar

**O que acontece.** A Vercel no plano **Hobby** aceita no máximo **2 cron jobs,
ambos diários**. Um terceiro cron — ou um cron não-diário — faz **todos os
deploys pararem silenciosamente**. Nenhum e-mail, nenhum erro óbvio: o site
simplesmente fica preso na versão velha.

**A defesa.** `scripts/check-vercel-crons.mjs` roda no `npm run build` e **falha
o build** se a `vercel.json` violar a regra. É por isso que o build tem um passo
a mais antes do `next build`.

Hoje os 2 slots são do `jueri-sync` (6h e 15h UTC).

**A regra que ficou.** Precisa de trabalho periódico? **Não crie cron.** Pegue
carona no tráfego, como faz `src/lib/health.ts` — o monitoramento inteiro do
sistema roda assim, sem consumir um slot.

---

### 12. A migração que caiu no meio e prendeu o site (10/08/2026)

**O que aconteceu.** Uma migração caiu no meio contra o banco real, com lojas
operando. O Prisma trava **todos os deploys seguintes** com erro `P3009` até
alguém destravar à mão. O site ficou preso na versão velha e cada push só gerava
outro e-mail de falha.

**A causa da queda.** A migração fazia `SET NOT NULL` numa coluna enquanto
pedidos novos continuavam nascendo sem ela. Com tráfego ao vivo, sempre haverá
uma linha nova sem o valor.

**O conserto.**
- As migrações viraram **reexecutáveis** (`IF NOT EXISTS` em tudo): rodar de novo
  depois de uma queda não quebra em "coluna já existe".
- O `DEFAULT` entra **antes** do preenchimento, para que a linha criada
  *durante* a migração já nasça carimbada.
- `scripts/migrate-deploy.mjs` no `vercel-build` destrava o P3009 sozinho — mas
  **só** para uma lista fechada de migrações comprovadamente reexecutáveis, só
  com o carimbo verdadeiro de "desfeita", e com **uma** nova tentativa. Migração
  antiga falhada **continua travando de propósito**: re-rodar SQL não-idempotente
  seria pior que ficar parado.

**A regra que ficou.** Migração roda **com lojas operando**. Escreva sempre
reexecutável, e ordene os passos pensando em quem está gravando dado no meio do
caminho.

---

## 🧾 Detalhes pequenos que derrubam tudo

### 13. Um coração no nome da cliente derrubava o romaneio (30/07/2026 — Entre Linhas, pedido #0137)

**O que a loja viu.** Abrir o romaneio do pedido #0137 devolvia **erro 500**. A
loja ficou sem o papel da separação.

**A causa.** As fontes padrão do PDF (Helvetica e cia.) só escrevem a tabela
WinAnsi — o alfabeto ocidental. Emoji não está lá, e a biblioteca **não ignora**
o que não sabe desenhar: ela **estoura**. Um emoji no nome da cliente, no nome da
peça ou na observação derrubava o romaneio inteiro. E acontece justamente onde
mais tem emoji: **pedido que veio do WhatsApp.**

**O conserto.** Um filtro em `lib/pdf-texto.ts`: acento do português e a
pontuação do WhatsApp (travessão, aspas curvas, reticências, bala) **continuam**;
emoji e símbolo exótico saem.

**O detalhe que importa.** A proteção ficou **na página**, não em cada chamada.
O romaneio escreve texto em mais de 30 lugares — bastava **um** desprotegido
para o PDF cair de novo. Um teste garante que nenhuma página crua volte a
aparecer.

**A regra que ficou.** Quando a proteção precisa valer em N lugares, coloque-a na
camada que todos atravessam — não em cada chamador.

📌 Testes: `pdf-texto.test.ts`, `romaneio.test.ts`

---

## 🔁 Os padrões que se repetem

Se você ler os 13 casos acima de uma vez, quatro coisas aparecem sempre:

**1. Erro silencioso é o pior tipo de erro.** `.catch(() => {})` fez sumir venda
(#3). O terceiro cron bloqueia deploy sem avisar (#11). O guarda com regex
frouxa passava verde enquanto 11 somas estavam erradas (#1). **Falhe alto.**

**2. Produção não é o seu ambiente.** Latência de rede (#4), tráfego durante a
migração (#12), 120 mil mensagens (#9), emoji no nome da cliente (#13) — nada
disso existe na sua máquina. Antes de subir mudança de dinheiro ou estoque,
reproduza contra o Postgres local **com o cenário real**.

**3. O caso de canto é onde mora o bug.** Dois pedidos ao mesmo tempo, o pedido
reaberto, a conversa antiga, o status raro. É o que o autor não vê no próprio
código — e é literalmente por isso que a revisão obrigatória existe (#2).

**4. O teste é o documento.** Regra de negócio que não tem teste com nome de
regra vai ser "simplificada" por alguém daqui a seis meses. Se você consertar um
bug de negócio, **deixe o teste** — e prove que ele pega o defeito, quebrando o
código de propósito.

---

> Achou um incidente novo? **Documente aqui**, no mesmo formato, com data e
> loja. Este arquivo só tem valor enquanto estiver vivo.
