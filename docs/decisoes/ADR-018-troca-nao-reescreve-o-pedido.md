# ADR-018 — Troca de peças é registro próprio: o pedido pago não é reescrito

- **Situação:** aceita
- **Regras ligadas:** RN-073 (a regra em si); RN-001/RN-002 (faturamento é o
  pedido pago, por `netTotal`); RN-003/RN-004 (estoque pelo livro, cancelar
  devolve o que o pedido segurou); RN-038 (comissão já lançada em mês
  fechado); RN-053 (espelho de estoque para a Nuvemshop); RN-060 (fila da
  Separação); RN-062 (grade cor × tamanho); RN-041 (preço sugerido)
- **Decidida em:** 08/10/2026

## Contexto

O dono relatou *"muita troca nos produtos"* e pediu um jeito simples de
registrar a troca no sistema, lembrando da integração com a Nuvemshop. A
troca de verdade acontece DEPOIS da venda: a cliente já pagou, a peça já
saiu, a comissão já contou, a nota já foi emitida, o lançamento já está no
Financeiro — e ela devolve uma Regata P e leva uma M, ou devolve uma regata
e leva um cropped mais caro.

Havia dois caminhos. **Editar os itens do pedido** (a porta que já existe):
o pedido passaria a dizer que a cliente comprou o cropped, o valor vendido
mudaria, o Financeiro refaria o lançamento, a comissão de um mês já fechado
mudaria, e a nota fiscal ficaria divergente do pedido. A história da venda
seria reescrita para contar uma coisa que não aconteceu naquele dia. **Ou
registrar a troca como fato próprio**, pendurado no pedido, com os próprios
movimentos de estoque e a própria conta de dinheiro.

## Decisão

1. **A troca é uma linha própria (`Troca` + `TrocaItem`), e o pedido não
   muda.** Valor vendido, status, data da venda, vendedora, comissão e nota
   seguem como estavam: são o retrato do dia em que a venda aconteceu. O
   que a troca registra é o que mudou DEPOIS: quais peças voltaram (e se
   voltaram boas ou com defeito), quais saíram, por quanto, e a diferença.
   O histórico do pedido ganha a frase inteira — foi o pedido explícito do
   dono: *"no pedido do cliente deve haver o registro de trocas como
   histórico"*.

2. **O estoque anda pelo livro de movimentos, com o `orderId` quando o
   estoque é daqui.** Peça boa que volta é ENTRADA; peça que sai é SAÍDA
   condicional (a mesma régua da venda, RN-003); defeito é ENTRADA + SAÍDA
   solta, para o livro contar que voltou e foi baixada sem o estoque mudar.
   Prender os movimentos ao pedido faz o pedido "segurar" o que a cliente
   tem AGORA — e cancelar depois da troca devolve a peça nova, não a antiga
   (RN-004 continua verdadeira sem código novo). A venda da Nuvemshop move o
   estoque SEM o pedido, porque o livro daqui nunca teve a saída dela: uma
   ENTRADA presa ao pedido deixaria o "reservado" do Inventário torto. O
   espelho para a loja online sai pela fila de sempre (RN-053): a Nuvemshop
   recebe o estoque novo, mas o pedido de lá não muda — e a tela diz isso.
   Como o livro do pedido passa a contar a troca e os itens não, **quem
   compara livro × itens** (a edição de itens) compara com o **pacote
   efetivo = itens ± trocas** (a edição, como segunda tranca, e a reserva
   ao restaurar um pedido cancelado); e o **teto do que pode voltar é por
   variação + preço pago**, nunca pelo id da linha (a edição recria as
   linhas; a mesma peça a dois preços vale o que cada uma custou).

3. **A diferença de dinheiro fica na troca, com a resolução escolhida.** O
   que volta vale o preço PAGO no pedido; o que sai vale o combinado. Zero
   não tem o que resolver; a cliente devendo só pode ser cobrada; a loja
   devendo escolhe crédito na ficha (livro `CustomerCredit`, saldo somado)
   ou devolução. Cobrança e devolução esperam alguém confirmar que o
   dinheiro andou, com nome e data. **O crédito acompanha o pedido**:
   cancelar estorna o crédito das trocas (a venda inteira está sendo
   devolvida), restaurar repõe, apagar estorna de vez — pelo saldo do
   livro, idempotente. O Financeiro e o Dashboard NÃO mudam
   na hora da troca — a diferença não é venda nova (RN-001) e
   lançá-la por conta própria furaria a porta única (RN-033). Abater o
   crédito num pedido novo e lançar a diferença no Financeiro são entregas
   seguintes, ditas na RN.

4. **O frete da troca é combinado, fora da conta** (decisão do dono): texto
   livre na troca e na história. Cotar/comprar etiqueta para a troca segue
   o caminho normal do módulo Envios, se a loja quiser.

5. **A troca pressupõe peça que JÁ SAIU.** Só pedido enviado, entregue
   ou a prazo entregue troca; pago/em produção/separação é recusado, com o
   caminho dito (marcar como entregue se a peça já foi; editar os itens se
   não foi). A Separação lê os itens e o Inventário lê o livro — uma troca
   ali deixava os dois contando a peça de jeitos opostos. E **depois da
   primeira troca os itens travam**: o que a cliente tem é itens ± trocas,
   e editar os itens "para refletir a troca" contaria a mesma peça duas
   vezes no estoque.

6. **Devolução sem peça nova não é troca.** É cancelamento (RN-004) ou
   edição de itens — a troca exige os dois lados, senão vira uma segunda
   porta de devolução concorrendo com a que já existe.

## Consequências

- A tela de Pedidos ganha o selo "N trocas"; a ficha do pedido, o bloco
  "Trocas"; a ficha da cliente, o saldo de crédito. Nenhuma métrica de
  faturamento, comissão ou DRE muda por causa de uma troca.
- **O crédito é DESCONTO no pedido em que for usado, nunca pagamento**
  (RN-074): a diferença que a troca devolveu à cliente é venda que voltou;
  como desconto no pedido novo, a soma das duas vendas bate com o caixa.
  O dinheiro que de fato andou (cliente pagou a diferença, loja devolveu)
  entra no Financeiro quando confirmado — receita de venda ou despesa
  "Devoluções e trocas".
- Relatório de trocas (quantas, por que, qual peça volta mais) sai dos
  registros `Troca`/`TrocaItem` — entrega própria.
- Limite aceito: a troca de uma venda da loja online acerta só o estoque;
  o pedido na Nuvemshop segue como estava.
