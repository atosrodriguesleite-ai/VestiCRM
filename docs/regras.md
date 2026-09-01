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
| RN-005 | Quem mandou o link (`?ref=`) leva a venda; sem link, o pedido nasce sem dona; venda da Nuvemshop não gera comissão e não aceita vendedora (nem admin) | `lib/catalogo/`, `/api/catalog/order`, `podeTransferirVenda` | `comissao-link.test.ts` |
| RN-006 | Pedido só vira PAGO com vendedor (exceção: venda da loja online, sem dona por RN-005); troca de vendedor é auditada em `OrderEvent` | `PATCH /api/orders/[id]` | `limpezas-lote5.test.ts` |
| RN-007 | Vendedora vê só os pedidos dela; gerente/admin/suporte veem a loja — em toda porta (exceção por pessoa: `pedidosVisaoTotal` — vê e, desde 18/08/2026, EDITA com tudo no histórico; comissão/transferência/exportação seguem regras próprias) | `lib/scope.ts` | `escopo-apis-lote1.test.ts` |
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
| RN-019 | Pacote montado pelas medidas de 1 peça por categoria (cotação do pedido + simulador gated); memória dos envios reais é a alternativa; estimativa declarada, e categoria sem medidas não muda nada | `lib/envios/pacote.ts`, `lib/envios/simulador.ts` | `simulador-frete.test.ts` |
| RN-020 | Cadastro duplicado por dígito errado: o sistema AVISA no chat, nunca junta sozinho (nome parecido E telefone a um dígito) | `lib/contatos-parecidos.ts` | `contatos-parecidos.test.ts` |
| RN-021 | Pedido por link pessoal: vale o WhatsApp da cliente, não o telefone digitado no formulário; a diferença é anotada no pedido | `lib/catalogo/telefone-do-pedido.ts` | `telefone-do-pedido.test.ts` |
| RN-022 | Mapa de envios com dois recortes: "todos os pedidos pagos" (endereço da etiqueta ou, na falta, da ficha da cliente) e "Melhor Envio" (só etiquetas, sem canceladas); o que não tem estado é contado e dito na tela | `lib/envios/mapa.ts` | `mapa-envios.test.ts` |
| RN-023 | Conectar integração exige crachá de OAuth sorteado com validade E sessão da própria loja com permissão de integrações; o resultado da volta é dito na tela | `lib/oauth-state.ts` | `oauth-state.test.ts` |
| RN-024 | Dados de envio pela própria cliente (link do chat, crachá sorteado 7 dias, régua de completo = etiqueta); razão social sai nos documentos e a ficha fica no nome de quem conversa; nome do WhatsApp em campo próprio | `lib/dados-envio.ts` | `dados-envio.test.ts` |
| RN-025 | Ficha de funcionário: registro da empresa sem vínculo com login; salário/documentos/CPF só ADMIN (gerente vê básico + emergência); ficha nunca é apagada — desligar arquiva; link de formulário para o próprio funcionário preencher (uso único, 7 dias, aceite LGPD, resposta aguarda conferência do admin) | `lib/funcionarios.ts` | `funcionarios.test.ts` |
| RN-026 | WhatsApp e catálogo público somam num canal só nas telas de métricas (Marketing, Relatórios, CSV); Nuvemshop e demais separados — soma só de apresentação, a origem no banco fica | `lib/canais.ts` | `canais.test.ts` |
| RN-029 | Módulo Financeiro gated (`financeEnabled`): toda porta exige a chave E gerente/admin (suporte fora); loja sem a chave não muda em nada; cadastro se arquiva, nunca se apaga (sem DELETE); árvore de categorias nasce pronta, código numerado pelo servidor e filha herda o tipo da mãe | `lib/financeiro/` | `financeiro-cadastros.test.ts` |
| RN-030 | Lançamento financeiro: parcelas sem perder centavo (sobra na última), vencimento mensal respeita fim de mês, data ao meio-dia UTC; status sempre calculado e o vencimento manda (parcial vencida = atrasada); baixa parcial e estorno com rastro (nunca apaga); baixa ativa trava o cancelamento e QUALQUER baixa trava a edição; baixa em transação serializável; cards somam o período inteiro | `lib/financeiro/lancamentos.ts` | `financeiro-lancamentos.test.ts` |
| RN-031 | Contas fixas: materializa os próximos 3 meses de carona no tráfego (nunca cron, ADR-002), único (recorrência, mês) impede duplicar, dia 31 respeita mês curto; editar/encerrar mexe só nos meses futuros sem baixa | `lib/financeiro/recorrencia.ts` | `financeiro-recorrencia.test.ts` |
| RN-032 | Transferência entre contas próprias não é receita nem despesa e tem duas datas (saiu/caiu), cancela em vez de apagar; no extrato o saldo é sempre somado (saldo inicial + entradas − saídas), nunca guardado | `lib/financeiro/extrato.ts` | `financeiro-recorrencia.test.ts` |
| RN-033 | Porta única de entrada das vendas: pedido/catálogo/Nuvemshop/Pix entram pelo mesmo lugar, 1 pedido = 1 lançamento (único por origem+origemId); máquina de estados pura decide criar/baixar o que falta/estornar só a automática/cancelar (inclusive ao voltar a orçamento) e o valor acompanha o pedido; baixa e cancelamento manuais são intocáveis; pedido apagado cancela o lançamento e a data corrigida move o mês; unificar contatos leva o financeiro junto; etiqueta chaveada pela compra (meOrderId) e cancelada estorna; roda no after() para a Vercel não congelar | `lib/financeiro/porta-vendas.ts` | `financeiro-porta-vendas.test.ts` |
| RN-034 | Cobrança pelo WhatsApp na tela de Inadimplência: mensagem montada pelo sistema e enviada por uma pessoa, pela Central (RN-017); mesma conta não é cobrada 2× no mesmo dia; recusa com frase em português quando falta cliente/telefone ou a parcela está quitada; envio que falha não vira "enviado" (a Central devolve FALHOU, não lança erro) | `lib/financeiro/cobranca.ts` | `financeiro-visao.test.ts` |
| RN-035 | Visão de dono: com o módulo, /financeiro vira painel (saldo por conta, mês, atrasado e saldo previsto 7/15/30 — previsão só do que está em aberto, com o atrasado dentro); DFC separa operacional/investimento/financiamento pelo código da categoria e a conta fecha com o saldo, dizendo a transferência E o saldo das contas cadastradas no período, cada um com o nome certo | `lib/financeiro/visao.ts` | `financeiro-visao.test.ts` |
| RN-036 | DRE por competência ("deu lucro?") e Fluxo de Caixa pela data do dinheiro ("tem dinheiro?") são contas diferentes; o DRE nasce montado pelo código da categoria e o investimento (07) fica FORA do resultado, dito na tela; no fluxo, o realizado vale sempre e o previsto só do mês corrente em diante, do previsto só entra o que falta e o atrasado cai no mês corrente | `lib/financeiro/relatorios.ts` | `financeiro-relatorios.test.ts` |
| RN-037 | Conciliação por OFX: o FITID do banco impede duplicar, o casamento automático só acontece quando a resposta é única, um depósito pode pagar várias parcelas e os dois lados têm que somar igual; conciliar carimba "conferido" e nunca mexe em baixa (mas estorno solta a conciliação); linha ilegível é contada e dita; o arquivo não é guardado | `lib/financeiro/conciliacao.ts`, `lib/financeiro/ofx.ts` | `financeiro-conciliacao.test.ts` |
| RN-038 | Ficha do lançamento mostra a nota do pedido e emite pelo Bling (que continua sendo quem emite; autorizada não se emite de novo); comissão vira conta a pagar da mesma fonte da tela, sem frete, com chave única por vendedora+período e recusa de período que encosta em outro | `lib/financeiro/nota-do-lancamento.ts`, `lib/financeiro/comissoes.ts` | `financeiro-cartao-comissao.test.ts` |
| RN-039 | Cartão de crédito: a conta do cartão não guarda dinheiro, junta as compras na fatura (fechamento/vencimento decidem qual, mês curto respeitado); pagar a fatura baixa todas de uma vez na conta do banco, em transação serializável; cartão nunca é conta padrão | `lib/financeiro/cartao.ts`, `lib/financeiro/cartao-fatura.ts` | `financeiro-cartao-comissao.test.ts` |
