# ADR-013 — Desconto é global: em %, incide sobre o total com acréscimo

- **Situação:** aceita
- **Regras ligadas:** RN-001, RN-002 (o valor vendido nasce desta conta)
- **Registrada em:** 21/08/2026 (decisão do dono)

## Contexto

O pedido aceita dois ajustes: **acréscimo** (taxa, serviço, ajuste para cima)
e **desconto**. Quando os dois existiam juntos e o desconto era em
porcentagem, a conta antiga descontava só sobre os produtos — o acréscimo
escapava do desconto. A lojista fazia a conta de cabeça ("10% sobre o total")
e o sistema mostrava outro número: pedido de R$ 1.000 com acréscimo de
R$ 100 e 10% de desconto dava R$ 900 + 100 = R$ 1.000 no sistema, quando a
loja combinou R$ 990 com a cliente.

## Decisão

1. **A ordem da conta é fixa: o acréscimo entra primeiro, o desconto sai por
   último.** Em %, o acréscimo incide sobre os produtos; o **desconto incide
   sobre o total já com o acréscimo** (desconto global). Em reais, ambos são
   valores absolutos.
2. `valor vendido (netTotal) = produtos + acréscimo − desconto`, com o
   desconto limitado a essa soma (pedido nunca fica negativo). Frete segue
   fora de tudo (ADR-004).
3. A conta vive num lugar só: `computeOrderTotals` (`lib/orders.ts`) — telas
   e rotas nunca refazem a fórmula por conta própria.
4. **Pedido antigo não é reescrito de carona.** A regra vale para quem MEXE
   no desconto a partir de 21/08/2026. Editar só o frete de um pedido com
   desconto % gravado NÃO recalcula o desconto pela regra nova (o PATCH
   preserva os valores gravados quando os ajustes vêm intactos) — senão um
   ajuste de frete mudaria o faturamento de pedido pago de mês fechado.

## Consequências

- As telas mostram os ajustes na ordem da conta (Acréscimo antes do
  Desconto) — editor de valores, ficha do pedido e romaneio.
- Guardas em `orders.test.ts` (a fórmula) e nos casos de "ajustes intactos"
  do PATCH de pedidos.
