# ADR-005 — O orçamento reserva estoque, e a reserva não tem prazo

- **Situação:** aceita
- **Regras ligadas:** RN-003, RN-004
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

No atacado a peça é única: quando duas clientes pedem a mesma grade, uma delas
vai ficar sem. A pergunta é **quando** o sistema segura a peça — no orçamento
ou só quando o pedido é pago?

Segurar só no pagamento vende a mesma peça duas vezes: a vendedora monta o
orçamento, manda para a cliente, e enquanto ela decide outra vendedora vende a
mesma grade.

## Decisão

1. **Todo pedido que não está CANCELADO segura estoque.** Isso vale para o
   pedido montado no sistema e para o pedido do catálogo público
   (`lib/reservations.ts`).
2. A baixa é **condicionada**: nunca deixa estoque negativo, nunca vende a
   mesma peça duas vezes (o banco decide, não a tela).
3. **A reserva não tem prazo.** A peça só volta quando o pedido é CANCELADO.
4. Ao **cancelar**, a vendedora escolhe:
   - **devolver as peças** (padrão) — o livro de movimentos
     (`InventoryMovement`) devolve exatamente o que saiu, nem mais nem menos;
   - **baixa definitiva** (`restock: false` → `Order.stockWrittenOff`) — perda,
     brinde, defeito. Nada volta ao estoque e nada é empurrado às integrações.
5. **Reabrir** um pedido com baixa definitiva **não desconta de novo**
   (`resolveCancelStock` / `resolveReopenStock` em `lib/orders.ts`).
6. Integração dona de estoque (Nuvemshop) espelha: **uma venda, uma baixa**.

## Consequências

- ✅ A grade que está no orçamento não é vendida por outra pessoa.
- ✅ O cancelamento vira uma decisão de negócio explícita, não um efeito
  colateral automático.
- ⚠️ Orçamento esquecido segura peça para sempre. Foi uma escolha consciente:
  a tela do pedido mostra quantas peças estão seguradas, e a lojista cancela
  quando quiser. O contrário — o sistema soltar sozinho — é pior.

## Alternativas descartadas

- **Soltura automática em 48h:** existiu e **foi removida**. Soltava peça de
  orçamento vivo (cliente que ia pagar na sexta), e o pior: ressuscitava
  estoque de pedido com baixa definitiva, empurrando o número errado para a
  Nuvemshop.
- **Reservar só no PAGO:** vende a mesma peça duas vezes. É o problema original.
