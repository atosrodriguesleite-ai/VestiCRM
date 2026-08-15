# ADR-010 — Revisão especialista obrigatória antes de todo push

- **Situação:** aceita
- **Decidida em:** 09/08/2026 (pedido do dono)

## Contexto

Push = produção. Não existe ambiente de homologação, não existe QA, e as lojas
que usam o sistema são reais e pagantes.

O gatilho foi concreto: uma revisão feita sobre um código **já dado como
pronto** encontrou **10 bugs**, e **3 deles escondiam dinheiro pendente** da
lojista. Nenhum apareceu em teste manual, porque todos moravam em casos de
canto — dois pedidos ao mesmo tempo, compromisso com data futura, status raro.

Esses são exatamente os casos que quem escreveu o código não enxerga: quem
escreve já sabe o caminho que imaginou, e testa esse caminho.

## Decisão

1. **Toda entrega passa por `/code-review` (nível high) antes do push.**
2. Os achados confirmados são corrigidos; só então o push acontece.
3. Quando a mudança mexe com **dinheiro, estoque, ou apaga/conclui dados
   sozinha**, a revisão não basta: o cenário é **reproduzido ponta a ponta
   contra o Postgres local** antes de subir. (Adivinhar já errou três vezes
   num único dia.)
4. **Exceção:** mudança trivial sem lógica — texto, cor, rótulo.

## Consequências

- ✅ Achados reais em praticamente toda rodada, inclusive em código que
  "estava pronto".
- ✅ O que o revisor encontra vira comentário no código e, quando é regra,
  vira teste — o mesmo erro não volta.
- ⚠️ Cada entrega fica mais lenta. É o preço combinado, e é barato perto de
  esconder dinheiro da lojista.

## Como isso aparece na prática

Uma entrega típica passa por: código → `npx tsc --noEmit` → `npm test` →
`npm run build` → `/code-review high` → corrigir achados → (se mexe com
dinheiro/estoque) cenário contra o Postgres local → push.
