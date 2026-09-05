# Runbook — deu problema em produção, e agora?

Sintoma → causa provável → o que fazer. Escrito para ser lido **no meio do
problema**, não antes.

Push na branch `claude/modacrm-clothing-crm-cxa9gf` = produção, em ~2-3 minutos.

---

## 🔴 Os deploys pararam de sair, sem erro nenhum

**Causa quase certa:** um 3º cron job, ou um cron não-diário, no `vercel.json`.
A Vercel **bloqueia todos os deploys em silêncio** — sem e-mail, sem erro
visível (ADR-002).

**O que fazer:** conferir `vercel.json`. Máximo 2 crons, ambos diários.
`npm run build` roda o guard `scripts/check-vercel-crons.mjs` e falha antes de
o problema chegar em produção — se o build passou local e o deploy não sai, o
`vercel.json` foi alterado depois.

**Trabalho periódico novo não vira cron.** Vira motor de carona no tráfego,
com trava atômica no banco (ADR-002).

---

## 🔴 O deploy falhou na migração do banco

**Causa provável:** migração que aplicou pela metade — a coluna já existe, o
`ALTER` tenta criar de novo e o `prisma migrate deploy` para tudo.

**O que fazer:** tornar o SQL idempotente (`ADD COLUMN IF NOT EXISTS`) e subir
de novo. Migração deste projeto é escrita à mão, sempre (ADR-001).

**Nunca:** rodar `prisma migrate dev` contra produção, nem `db:seed` em
produção (zera/duplica dados de lojas reais).

---

## 🟠 A lojista diz que o WhatsApp "caiu"

1. Abrir **`/saude`** (Super Admin) — o vigia de `lib/health.ts` mostra o
   servidor Evolution e a conexão de cada loja.
2. Servidor fora do ar → VPS Hostinger `srv1853369.hstgr.cloud`, projeto
   Docker `evolução-api-2zk0`.
3. Servidor de pé mas a loja desconectada → a lojista reconecta pelo QR Code
   em Configurações. **Número banido pela Meta é possível** e é o risco
   assumido no ADR-007 — nesse caso o QR não resolve.

---

## 🟠 "Mandei o pedido pelo catálogo e ele não apareceu"

Não deveria acontecer: o pedido do catálogo tem protocolo e a rota é
idempotente (ADR-008).

1. Procurar pelo **protocolo** (`Order.clientRef`) — a cliente vê esse número
   no recibo da tela.
2. Não existe? A venda pode ser resgatada da conversa: **"Colar pedido do
   WhatsApp"** na tela Pedidos, que lê a mensagem e cria pelo caminho normal,
   com preço do nosso cadastro.

---

## 🟠 Número de faturamento diferente entre duas telas

**Causa quase certa:** alguma soma está usando `total` (que inclui frete) em
vez de `netTotal` (ADR-004).

**O que fazer:** `npm test` — o `faturamento-data.test.ts` varre as telas de
dinheiro e aponta o arquivo. Se o uso for legítimo (contas a receber), declarar
com o marcador `frete-ok` e o motivo.

---

## 🟠 "A peça sumiu do estoque" / "voltou sozinha"

O estoque nunca se mexe sozinho: o livro de movimentos (`InventoryMovement`)
tem o histórico completo.

- Peça **presa**: pedido não-cancelado segura estoque, **sem prazo** (ADR-005).
  A tela do pedido mostra quantas peças estão seguradas.
- Peça que **não voltou** no cancelamento: foi baixa definitiva
  (`Order.stockWrittenOff`) — perda, brinde ou defeito, escolhido por quem
  cancelou.

---

## 🟠 A cotação de frete só mostra Correios

Já aconteceu, e a causa era nossa: não pedíamos a lista completa de serviços ao
Melhor Envio, e ele devolvia só o padrão da conta.

Hoje o sistema pede todos e a tela mostra **"N não cotaram — ver o motivo"**.
Se voltar a faltar transportadora, o motivo está escrito ali.

---

## 🔵 Erro de produção que ninguém entende

`src/instrumentation.ts` captura os erros (`onRequestError`) e joga no painel
**`/saude`** (Super Admin), com `ErrorLog` no banco.

---

## 🔵 Todos os tokens de integração pararam de funcionar de uma vez

**Causa quase certa:** o `AUTH_SECRET` foi trocado sem existir um
`CRED_SECRET` próprio. Sem `CRED_SECRET`, é o `AUTH_SECRET` que criptografa os
tokens no banco — trocar um torna ilegível o outro, e **todas** as lojas
perdem Melhor Envio, Nuvemshop, Bling e Mercado Pago ao mesmo tempo.

**O que fazer:** repor o `AUTH_SECRET` antigo. Não há como decifrar sem ele —
o único caminho alternativo é cada lojista reconectar tudo à mão. Detalhes em
[`integracoes.md`](integracoes.md).

---

## Rodar o banco local (porta 5433)

```bash
bash scripts/dev-postgres.sh   # sobe o Postgres local, se o script funcionar aqui
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/vesticrm" npx prisma migrate deploy
```

Se a pasta do banco não existir (container novo):

```bash
mkdir -p /var/lib/postgresql/vesti && chown postgres:postgres /var/lib/postgresql/vesti
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/vesti -U postgres --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/vesti -o '-p 5433' -l /tmp/pg.log start"
psql -p 5433 -U postgres -h localhost -d postgres -c "CREATE DATABASE vesticrm"
```

## Antes de qualquer push

```bash
npx tsc --noEmit && npm test && npm run build
```

E a revisão especialista (`/code-review`, nível high) — obrigatória (ADR-010).
Mexeu com dinheiro, estoque ou apagar dados? Reproduzir o cenário contra o
Postgres local antes de subir.

`npm run build` roda dois guardas antes de compilar: o de crons
(`check-vercel-crons.mjs`, ADR-002) e o da documentação (`check:docs` →
`docs-regras.test.ts`), que reprova se o índice de regras, o `CLAUDE.md` e os
testes guardiões discordarem.

## Mudança de schema (nunca `prisma migrate dev`)

1. Alterar `prisma/schema.prisma`;
2. escrever o SQL **à mão** em `prisma/migrations/` (ADR-001), idempotente;
3. aplicar no banco local e reproduzir o cenário;
4. push — produção aplica sozinha via `vercel-build`.

Mudança **aditiva** (coluna/tabela nova) é segura. Mudança **destrutiva**
(renomear/remover) vai em etapas: adiciona → migra os dados → remove depois,
em outro deploy.

## Limpar a Central de UMA loja para ela "começar do zero" (05/09/2026)

Caso Entre Linhas: conectou o WhatsApp uma vez por pouco tempo, acumulou ~1.000
conversas nascidas só de pedidos do catálogo (RN-008/RN-010) e quis reconectar
limpa. Combinado com o dono: **encerrar, nunca apagar** — Fila e Chats esvaziam,
o histórico fica em Contatos, e a cliente antiga que escrever reabre a conversa
dela com tudo dentro.

Como foi feito e como repetir para outra loja:

1. Não existe botão de propósito (decisão do dono): é uma **migração única**
   escrita à mão, modelo em `prisma/migrations/20260905150000_entre_linhas_encerrar_conversas/`.
   Copiar o arquivo com data nova e trocar o nome da loja.
2. A instrução acha a loja pelo **nome exato** (sem diferença de maiúscula e
   espaço nas pontas) **ou pelo endereço do catálogo** (slug) e exige
   **exatamente uma**: zero ou duas, não faz nada e o deploy segue — mas
   deixa um evento `conversas.encerradas-em-lote` com status ERRO **sem
   loja** na Central de Comunicação da plataforma, porque a migração não
   roda de novo e um aviso no log do deploy ninguém lê. Nunca chuta (RN-013).
   **Antes de subir, conferir o nome e o slug no painel Lojas do Super
   Admin; depois do deploy, conferir que o evento OK apareceu na Central da
   loja** (sem ele, a limpeza não aconteceu).
3. O que ela faz: `status = CLOSED` (o mesmo gesto do botão Encerrar), zera o
   marcador de não lida da loja inteira, toca o `updatedAt` para o sync da tela
   enxergar, e grava um `CommEvent` `conversas.encerradas-em-lote` na Central
   de Comunicação da loja com a quantidade.
4. Antes de subir, provar no Postgres local com `scripts/prova-limpeza-central.ts`
   (loja alvo + vizinha + nome duplicado): a vizinha não muda, o duplicado é
   recusado com rastro, a alvo fica com zero abertas e mensagens intactas.
   ```
   set -a; source .env; set +a
   npx tsx scripts/prova-limpeza-central.ts prisma/migrations/<pasta>/migration.sql "Nome da Loja" slug-da-loja
   ```

Se um dia a loja pedir para APAGAR de vez: `Message` cai em cascata com a
conversa, `Order.conversationId` vira nulo (o pedido fica), clientes/funil/
tarefas não são tocados — mas é irreversível, e o dono decide.
