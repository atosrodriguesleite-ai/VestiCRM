# ADR-004 — Faturamento soma `netTotal`, nunca `total`

- **Situação:** aceita
- **Regras ligadas:** RN-001, RN-002
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

O pedido tem dois valores parecidos, e confundir os dois **inventa dinheiro**:

| Campo | O que é | Para que serve |
|---|---|---|
| `netTotal` | peças − desconto + acréscimo | **valor vendido** |
| `total` | `netTotal` + frete | o que a cliente paga |

Frete não é faturamento da loja: é custo repassado. Somar `total` nas telas de
dinheiro faz o Dashboard mostrar um faturamento maior do que existe — e a
lojista toma decisão de compra e de comissão em cima de um número inflado.

## Decisão

1. **Toda métrica de faturamento soma `netTotal`.** Vale para Dashboard,
   Relatórios, Inteligência, Comissões, Equipe, exportações e segmentos.
2. **Venda = `Order` com status em `PAID_ORDER_STATUSES`**
   (`PAGO, EM_PRODUCAO, SEPARACAO, ENVIADO, ENTREGUE`, em `lib/orders.ts`).
   O modelo `Sale` é legado do fluxo manual e **não entra em métrica**.
3. Uso legítimo de `total` existe — contas a receber é literalmente o que a
   cliente paga, frete incluso. Esse uso **se declara** com o marcador
   `frete-ok` e o motivo, na própria linha ou nas duas acima.
4. A regra é guardada por teste: `faturamento-data.test.ts` varre as telas de
   dinheiro procurando `_sum`/`select`/`orderBy`/`+ .total` sem o marcador.

## Consequências

- ✅ Um número só, em todas as telas. Fecha com o extrato.
- ✅ A exceção é possível, mas fica visível e justificada no código.
- ⚠️ Código novo que soma dinheiro precisa passar pelo guard — se o teste
  reclamar, a resposta certa quase sempre é trocar para `netTotal`, não
  adicionar o marcador.

## Incidente relacionado

A primeira versão do guard tinha regex frouxa e **deixou passar seis somas com
frete no Dashboard**. Daí a frase que virou lema do projeto:
*guarda que não pega nada é pior que nenhum*.
