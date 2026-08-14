# ADR-006 — Quem mandou o link leva a venda, e só ele

- **Situação:** aceita
- **Regras ligadas:** RN-005, RN-006, RN-011
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

Comissão é o assunto mais sensível de uma loja. Se o pedido cair no painel da
pessoa errada, a briga é imediata — e o sistema perde a confiança da equipe
inteira de uma vez.

O caso real: a cliente chega no WhatsApp, a Lara manda **o link dela**, a
cliente monta o pedido. O pedido caía no painel da **Juliana**, porque a
Juliana era a responsável pela carteira daquela cliente. A Lara trabalhou, a
Juliana levou.

## Decisão

1. Pedido **montado no sistema** → é de quem montou.
2. Pedido do **catálogo público com `?ref=`** → é de **quem mandou o link, e
   só dele**. A carteira acompanha: `Customer.ownerId` passa a ser dessa
   vendedora, com registro na linha do tempo.
3. Pedido do catálogo **sem `?ref=`** → nasce **sem dona** (é da loja).
   **Não existe desvio para a responsável pela cliente** — era exatamente esse
   desvio que causava o problema.
4. Pedido vindo da **Nuvemshop** → sem vendedor.
5. **Pedido só vira PAGO com vendedor definido.** É o que obriga a loja a
   resolver a dona antes de faturar, em vez de deixar para depois.
6. Troca de vendedor é **auditada** em `OrderEvent`.
7. O aviso de pedido novo segue a mesma régua: com vendedora no link, só ela;
   sem vendedora, gerência/admin — nunca uma vendedora qualquer.

## Consequências

- ✅ A régua é explicável em uma frase para a equipe: *o link é seu, a venda é
  sua*.
- ✅ Pedido sem dona é visível e cobra uma decisão antes do faturamento.
- ⚠️ Vendedora que manda o catálogo sem o `?ref=` dela perde a venda. É o preço
  de não ter adivinhação — e a tela sempre entrega o link já com o `ref`.

## Alternativas descartadas

- **Cair para a responsável pela carteira:** é o comportamento que gerou a
  reclamação. Descartado sem volta.
- **Dividir a comissão entre as duas:** ninguém entende, ninguém confere.
