# ADR-011 — A etiqueta sai com NF-e quando a nota existe; senão, declaração

- **Situação:** aceita
- **Regras ligadas:** RN-016
- **Decidida em:** 14/08/2026

## Contexto

O Melhor Envio aceita dois documentos para um envio:

- **declaração de conteúdo** (`non_commercial: true`) — a loja preenche o papel;
- **NF-e** (`invoice.key` = chave de acesso de 44 dígitos) — a nota viaja na
  própria etiqueta.

O sistema mandava sempre `non_commercial: true`, sem alternativa. Loja que
emite nota (via Bling) tinha que preencher declaração à mão mesmo tendo NF.

## Decisão

O sistema **não pergunta nada**: o que manda é a nota existir de verdade.

1. Pedido com nota **AUTORIZADA** → etiqueta com **NF-e**.
2. Pedido sem nota, ou com nota emitindo/rejeitada → **declaração de conteúdo**.
3. A chave é **conferida no Bling imediatamente antes** de debitar o saldo da
   carteira Melhor Envio. Nota cancelada no painel do Bling não vira etiqueta
   apontando para nota morta — e a compra é recusada **antes** de gastar
   dinheiro.
4. A chave que **foi usada** fica gravada na própria etiqueta
   (`Shipping.nfeKey`), não só no pedido. Etiqueta comprada antes da nota
   continua sendo declaração de conteúdo, e a tela diz isso — ler o estado
   atual do pedido faria a tela mentir sobre o passado.
5. Chave malformada **não derruba a compra**: cai para declaração. Ficar sem
   etiqueta por causa de um caractere é pior.
6. Bling fora do ar **não prende a etiqueta**: a tela oferece *"comprar mesmo
   assim, com declaração de conteúdo"*. É escolha explícita da loja — o
   sistema nunca troca o documento fiscal por conta própria.

## Consequências

- ✅ Quem emite nota para de preencher papel.
- ✅ Quem não emite não vê diferença nenhuma.
- ⚠️ O CNPJ que emitiu a nota precisa bater com o remetente cadastrado em
  Configurações → Melhor Envio, senão o ME recusa. A mensagem de erro diz isso.

## Alternativas descartadas

- **Trocar sozinho para declaração quando o ME recusa a nota:** se existe nota,
  é a nota que tem que viajar com a caixa. Trocar em silêncio cria problema
  fiscal para a loja.
- **Deixar a loja escolher o documento a cada envio:** mais um clique em toda
  venda, para uma decisão que os dados já respondem.
