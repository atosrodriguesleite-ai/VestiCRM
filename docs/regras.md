# Índice das regras de negócio (RN)

Este arquivo é um **índice**, não a regra. O texto completo de cada regra — com
o motivo e o incidente que a criou — vive no **`CLAUDE.md`**, que é lido no
começo de toda sessão. Duplicar o texto aqui criaria duas versões que um dia
discordam.

Serve para uma coisa só: transformar `RN-014` em algo que se resolve em dois
segundos, para que uma tarefa possa dizer

> *implementar isso respeitando **RN-003** e **RN-005***

sem ambiguidade.

## Regras do jogo

- Número **nunca** é reaproveitado e **nunca** é renumerado.
- Regra que deixa de valer não some: vira
  `RN-0XX (revogada em MM/AAAA, substituída por RN-0YY)`.
- Toda RN existe **nos três lugares** — aqui, no `CLAUDE.md` e **dentro do
  teste que a guarda** (marcador `// Guarda RN-0XX`). O teste
  `docs-regras.test.ts` roda no `npm run build` e **reprova** se qualquer um
  dos três discordar. Sem isso o índice envelhece em silêncio, que é pior que
  não ter índice.

## Índice

| ID | Regra em uma linha | Onde vive | Guardada por |
|---|---|---|---|
| RN-001 | Venda = `Order` com status em `PAID_ORDER_STATUSES`; `Sale` é legado e não entra em métrica | `lib/orders.ts` | `faturamento-data.test.ts` |
| RN-002 | Faturamento soma `netTotal`, nunca `total` (frete); exceção se declara com `frete-ok` | telas de dinheiro | `faturamento-data.test.ts` |
| RN-003 | Pedido não-cancelado segura estoque; a reserva não tem prazo | `lib/reservations.ts` | `reserva-sem-prazo.test.ts` |
| RN-004 | Ao cancelar, escolhe-se devolver ou baixa definitiva; reabrir não desconta de novo | `lib/orders.ts` | `cancel-stock.test.ts` |
| RN-005 | Quem mandou o link (`?ref=`) leva a venda; sem link, o pedido nasce sem dona | `lib/catalogo/`, `/api/catalog/order` | `comissao-link.test.ts` |
| RN-006 | Pedido só vira PAGO com vendedor; troca de vendedor é auditada em `OrderEvent` | `PATCH /api/orders/[id]` | `limpezas-lote5.test.ts` |
| RN-007 | Vendedora vê só os pedidos dela; gerente/admin/suporte veem a loja — em toda porta (exceção por pessoa: `pedidosVisaoTotal`, sem mexer em comissão/transferência/exportação) | `lib/scope.ts` | `escopo-apis-lote1.test.ts` |
| RN-008 | Lead entra só pelo `lib/intake.ts`; dedup tolerante ao 9º dígito; conversa nasce na fila | `lib/intake.ts` | `intake.test.ts` |
| RN-009 | Preço e total do catálogo são SEMPRE recalculados no servidor | `lib/orders.ts` (`/api/catalog/order`) | `orders.test.ts` |
| RN-010 | O pedido do catálogo não pode se perder: protocolo `clientRef` + rota idempotente | `lib/catalogo/envio-pedido.ts` | `envio-pedido.test.ts` |
| RN-011 | O aviso de pedido novo segue a separação por link: com `ref`, só ela; sem, gerência | `notifyNovoPedido` | `envio-pedido.test.ts` |
| RN-012 | "Colar pedido do WhatsApp": preço sempre do nosso cadastro; linha sem cadastro fica de fora | `lib/catalogo/ler-mensagem.ts` | `ler-mensagem.test.ts` |
| RN-013 | Toda query filtra por `companyId`, pelos helpers de `lib/scope.ts` | `lib/scope.ts` | `escopo-apis-lote1.test.ts` |
| RN-014 | A Nuvemshop é a dona do estoque; casamento de produtos só por SKU; uma venda, uma baixa | `lib/nuvemshop.ts` | `nuvemshop-conferencia.test.ts` |
| RN-015 | Anúncio → campanha é retroativo para quem não tem, nunca reescreve quem já tem | `lib/ad-match.ts` | `anuncio-campanha.test.ts` |
| RN-016 | Nota AUTORIZADA → etiqueta com NF-e; sem nota → declaração de conteúdo | `lib/melhorenvio.ts` | `etiqueta-com-nfe.test.ts` |
| RN-017 | WhatsApp: termo de aceite obrigatório antes do QR; envio proativo com ritmo humano | `lib/comm/evolution.ts` | `evolution.test.ts` |
| RN-018 | Tabelas de preço por link (gated): o link decide o preço, atacado exige a quantidade mínima, e loja sem o recurso não muda em nada | `lib/catalogo/tabelas-de-preco{,-servidor}.ts` | `tabelas-de-preco.test.ts` |
