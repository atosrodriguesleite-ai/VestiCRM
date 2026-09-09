# ADR-016 — Quem manda no estoque: a integração que vende é dona do número, e todo ajuste digitado tem uma porta só

- **Situação:** aceita
- **Regras ligadas:** RN-050, RN-051, RN-052 (as regras em si); RN-014 (a
  Nuvemshop é a dona do estoque); RN-003 (reserva); ADR-002 (alerta de
  carona, nunca cron); ADR-012 (tela não arrasta banco)
- **Decidida em:** 09/09/2026

## Contexto

A tela Produtos aceitava um número digitado numa variação vinculada à
Nuvemshop, gravava aqui e NÃO mandava para lá. A sincronização seguinte
voltava por cima ("o sistema perdeu meu ajuste") e, no meio, o catálogo
vendia uma peça que a loja online já tinha vendido. O dono pediu, ao
desenhar o módulo Estoque: *"caso o cliente tenha Nuvemshop ou outro
sistema de e-commerce ou marketplace, esse outro sistema continua mandando
no estoque, e deve respeitar as integrações"*. Pediu também alertas de
mínimo e "análise inteligente" — sem cron novo (ADR-002) e sem IA.

## Decisão

1. **Peça com vínculo é só leitura em TODA tela.** O vínculo é por variação
   na Nuvemshop (`ProductVariant.nuvemshopId`) e por produto no Jueri
   (`Product.jueriId`); `donoDoEstoque` é o ÚNICO lugar que decide isso.
   Venda (RN-003) e produção continuam movendo peça vinculada — são
   movimentos reais, com espelho para a Nuvemshop. A grade dela (cor,
   tamanho, remover) também se mexe lá.
2. **Todo estoque DIGITADO passa por `ajustarEstoque`**: loja (RN-013),
   papel (dito por quem chama), dono, motivo obrigatório, gravação
   condicional ao número visto, número + linha do livro na mesma
   transação. Tela nova de estoque não grava direto na variação.
3. **Marketplace novo que venda declara dono em `donoDoEstoque`**, nunca
   contorna a porta.
4. **Mínimo por variação com precedência peça > categoria > loja**, régua
   "chegou = disponível ≤ mínimo" (zerada inclusa), uma só para toda tela
   e para o alerta; alerta uma vez por variação (carimbo), em resumo, de
   carona no tráfego com trava por loja.
5. **Análise por regra dita na tela** (giro, cobertura, encalhada, repor);
   sem IA, por decisão do dono.

## Consequências

- ✅ O número da loja online nunca é sobrescrito por engano; o histórico
  nunca mente (número e livro nascem juntos).
- ✅ Regra num lugar só: a próxima integração custa um `case` em
  `donoDoEstoque`, não uma auditoria em cada tela.
- ⚠️ A lojista com Nuvemshop precisa ajustar lá e sincronizar aqui —
  aceito, com cadeado, nome do dono e botão de sincronizar na tela.
- ⚠️ O alerta depende de tráfego: loja parada, sem ninguém na Central ou
  no Estoque, não é avisada até alguém abrir (limite do ADR-002).

## Alternativas descartadas

- **Empurrar o ajuste digitado para a Nuvemshop**: inverte quem manda e
  cria conflito de sync nos dois sentidos.
- **Alerta por cron**: ADR-002 (um 3º cron trava todos os deploys).
- **IA no painel**: decisão do dono — inteligente aqui é conta que a
  lojista confere.
