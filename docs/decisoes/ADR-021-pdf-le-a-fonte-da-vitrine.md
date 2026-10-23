# ADR-021 — O catálogo em PDF lê a fonte da vitrine, e é uma fotografia do momento

- **Situação:** aceita
- **Regras ligadas:** RN-094 (a regra em si); RN-009 (quem manda no preço é o
  servidor); RN-018 (tabela de preço por link); RN-041 (qual preço o catálogo
  mostra); RN-067 (o teto do estoque na vitrine); RN-070 (a logo pesada que
  travava a página); RN-013 (recorte por loja); RN-038 (texto seguro no PDF)
- **Decidida em:** 23/10/2026

## Contexto

Relato recorrente do dono: *"alguns clientes estão reclamando que o catálogo
não tá abrindo. É uma reclamação recorrente e a gente não conseguiu
resolver"*. A proposta dele foi um paliativo — *"converter o catálogo que a
gente tem online em PDF… como se fosse a página mesmo do website, só que um
PDF estático"* — para mandar no WhatsApp de quem não consegue abrir o link.

A causa mais provável já tinha sido curada: a RN-070 tirou a logo de dentro
da página (12,4 MB e 18 s no 4G fraco viraram 1,2 MB e 1,7 s). Mas "não
abre" tem outras causas que nenhuma otimização nossa alcança — navegador
velho, o navegador de dentro do WhatsApp, bloqueio na rede da empresa,
JavaScript desligado — e a vitrine são dezenas de idas à internet (uma por
foto): basta uma falhar para a cliente ver tela branca.

## Decisão

1. **O PDF não é mais leve que a página, e não é por isso que ele existe.**
   Medido: 243 peças = 29 páginas = 2,2 MB. A página hoje está em ~1,2 MB.
   O que o PDF resolve é outra coisa, e é mais forte: é **UM arquivo**, que
   baixa de uma vez, fica no aparelho, abre sem internet, sem navegador e
   sem JavaScript, e a cliente repassa para a amiga. É paliativo assumido —
   não substitui achar a causa raiz do "não abre".

2. **O PDF lê a MESMA fonte da vitrine, e por isso a vitrine foi refatorada
   primeiro.** A leitura do acervo (quais peças, qual preço) saiu do
   componente de servidor para `lib/catalogo/acervo.ts`, e a régua de "um
   card por cor, nesta ordem" saiu do componente de navegador para
   `lib/catalogo/secoes.ts`. Os dois caminhos passaram a importá-las.

   Copiar as regras teria sido mais rápido e é o erro que esta decisão
   proíbe: no dia em que a vitrine ganhar uma chavinha nova, o papel
   passaria a mostrar peça que o site não mostra — ou, pior, **preço que a
   loja não cobra**. Preço é dinheiro, e dinheiro não pode divergir entre
   telas. É a mesma régua do painel de Recompra ("este painel não faz conta
   própria", RN-084) e do relatório do BI em PDF (RN-090).

   Consequência aceita: os guardas que varriam o código do produtor da
   vitrine passaram a apontar para as libs. O **catálogo de campanha**
   (`/catalogo/<loja>/c/<promo>`) continua com a leitura dele, porque o
   acervo dele é outro (recortado pela campanha) — ele segue vigiado pelos
   mesmos guardas, lado a lado com a lib.

3. **O PDF é uma FOTOGRAFIA DO MOMENTO, e isso é dito no próprio arquivo.**
   Preço e estoque congelam no dia da geração e a cliente ainda estará com
   ele daqui a dois meses. A capa leva a data ("preços e disponibilidade de
   23/10/2026") e o pedido de confirmar com a loja; a resposta vai com
   `no-store`, para nenhuma CDN entregar preço velho. Sem isso, alguém pede
   pelo preço antigo e a loja só descobre no fechamento.

4. **Nada do PDF pode derrubar a geração.** As fotos moram no banco como
   data-URL (dívida nº 1) e podem ser link externo; a função da Vercel morre
   em 60 s. Então há orçamento de tempo, as fotos são deduplicadas e
   recortadas pelo sharp (o pdf-lib não recorta), e o que não couber **sai
   sem foto e é contado** — o resultado diz quantas. Acima de 600 peças o
   arquivo corta e a última página explica o caminho (gerar por categoria).
   Catálogo com uma foto faltando é melhor que função morta sem resposta.

## Consequências

- Mexer na regra da vitrine agora muda o PDF junto, de graça. Mexer **só no
  PDF** é que passou a ser o caminho errado: se a diferença não for de
  papel (os tamanhos escritos no card, porque no papel não há toque para
  abrir a grade), ela é um defeito.
- O catálogo de campanha fica como terceira leitura até alguém precisar de
  PDF de campanha; quando precisar, ele vem para a lib.
- A dívida nº 1 (fotos como data-URL) ganhou mais um motivo: aqui ela é o
  que impõe o orçamento de tempo.
- Ficou de fora, de propósito: **mandar o PDF pelo WhatsApp direto da
  Central**. O arquivo tem 2 MB e seria guardado como data-URL no banco a
  cada envio. A vendedora baixa e encaminha pelo aparelho dela, que é o que
  o dono descreveu.
