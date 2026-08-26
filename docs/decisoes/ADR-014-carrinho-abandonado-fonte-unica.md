# ADR-014 — Carrinho abandonado tem UMA fonte: a esteira de Recuperação

- **Situação:** aceita
- **Regras ligadas:** RN-013 (a esteira é por loja); RN-017 (a 1ª mensagem
  automática sai pelo ritmo anti-ban)
- **Registrada em:** 26/08/2026 (decisão do dono)

## Contexto

Duas telas falavam de carrinho abandonado com **duas contas paralelas**: a
tela **Recuperação** lia a esteira (`AbandonedCart` — que sabe quem já foi
chamada, quem recuperou, quem a loja marcou como perdida, e inclui os
checkouts da Nuvemshop) e a **Inteligência** recalculava tudo por conta
própria a partir das sessões de navegação.

Duas contas paralelas produziram exatamente os defeitos previsíveis: números
diferentes nas duas telas, sacola desenhada de um jeito em cada uma e — o
pior — a vendedora via "recupere com uma mensagem" na Inteligência para uma
cliente que a esteira **já tinha chamado** (ou que já tinha comprado), e a
segunda mensagem queimava a loja.

## Decisão

1. **A esteira (`AbandonedCart`, `lib/recuperacao.ts`) é a única fonte.**
   O KPI e a lista da Inteligência leem dela por um funil único
   (`carrinhosAbertosDaEsteira` em `lib/tracking/insights.ts`). Nenhuma tela
   nova pode recalcular carrinhos por sessões — se a esteira não sabe de um
   carrinho, o lugar de corrigir é a esteira.
2. **"Aberto" = `NOVO` ou `CHAMADA`**, com o abandono dentro do período da
   tela. Recuperado e perdido não são dinheiro parado.
3. **Quem JÁ PEDIU depois do abandono não é abandono** — por qualquer porta,
   mesmo sem pagar: pedido não-cancelado da cliente identificada, ou
   conversão de outra sessão da mesma visitante anônima. O pedido PAGO fecha
   o carrinho na própria esteira (`marcarRecuperados`, inclusive para a
   anônima, casando pedido → sessão → pessoa); o pedido enviado-sem-pagar
   mantém o carrinho na fila de trabalho da tela Recuperação, mas a
   Inteligência não manda cutucar.
4. **A varredura continua de carona no tráfego** (ADR-002: sem cron novo);
   abrir a Inteligência também dá a carona.

## Consequências

- Um número só nas duas telas; a sacola exibida é a gravada no carrinho.
- A Inteligência mostra "Já chamada" — o aviso que evita a segunda mensagem.
- O carrinho só existe depois da varredura (até 1h + rodada de 10 min após o
  abandono) — é o preço de uma fonte só, e é o mesmo atraso da tela
  Recuperação.
- Guardas: `marketing-honesto.test.ts` (fonte única e exclusões) e
  `recuperacao.test.ts` (a esteira em si).
