# ADR-017 — O código de barras da variação é gerado pelo BANCO, e a etiqueta é uma lista só para três saídas

- **Situação:** aceita
- **Regras ligadas:** RN-059 (a regra em si); RN-013 (recorte por loja na
  leitura); RN-050 (peça vinculada: o código é nosso, o estoque é de lá);
  ADR-001 (migração escrita à mão); ADR-012 (a prévia roda no navegador sem
  arrastar banco)
- **Decidida em:** 18/09/2026

## Contexto

O dono pediu um módulo de etiquetas com leitor de código de barras para
separar pedidos "sem erro de operação": bipa a embalagem, o sistema aceita
só o que está no pedido, na quantidade do pedido. Não existia campo de
código de barras — o SKU é opcional e livre. Decisões do dono: o sistema
gera o código; a impressora em mãos é uma Zebra 220; toda a equipe separa,
com registro de quem separou; preço do módulo a definir.

Uma variação (cor × tamanho) nasce por CINCO caminhos no código: ficha da
peça, cadastro em lote, sincronização da Nuvemshop, importação de catálogo
e produção. Já perdemos dinheiro pendente por "três respostas do PATCH,
duas esqueciam o financeiro" (RN-033) e "espelho da Nuvemshop em chamada
solta" (RN-053): a classe de defeito "esqueceu um caminho" é a que mais
custou nesta base.

## Decisão

1. **O código nasce no banco.** `ProductVariant.barcode` é preenchido por
   um gatilho `BEFORE INSERT` (migração `20260918100000`) a partir de uma
   sequência única da plataforma, com a função SQL `ean13_interno`. Não há
   caminho de criação de variação que possa esquecer — inclusive os que
   ainda vão existir. É a única regra de negócio que mora num gatilho, e é
   declarada aqui de propósito: o Prisma não a enxerga, então quem mexer na
   tabela precisa saber que ela existe.
2. **EAN-13 interno, prefixo 2.** É o formato que todo leitor lê de fábrica,
   a Zebra desenha nativo (`^BE`) e cabe numa etiqueta de 30 mm; a faixa
   20–29 do GS1 é de uso interno e não colide com produto de mercado. A
   conta do dígito verificador existe em SQL (no banco) e em TypeScript
   (para conferir o bipe e desenhar as barras), e um script prova que as
   duas concordam.
3. **O código nunca muda e é único na plataforma.** Etiqueta colada na
   peça tem que continuar valendo; o gatilho é só de INSERT e nenhuma rota
   escreve `barcode`. A unicidade é global (índice único) e a leitura recorta
   pela loja: código de outra loja simplesmente não é achado.
4. **Uma lista de elementos, três saídas.** A etiqueta é uma lista de
   elementos em milímetros; ZPL (Zebra), PDF (qualquer impressora pelo
   driver) e SVG (prévia) leem a MESMA lista. O editor de modelos da etapa 4
   só precisa mexer na lista. Guardar três desenhos separados faria a
   prévia divergir da impressora — exatamente o que faz a loja parar de
   confiar na tela.
5. **A chave do módulo abre só as portas.** O código existe para toda loja;
   `etiquetasEnabled` libera imprimir e (etapa 3) bipar. Toda a equipe
   entra: é operação de quem está na arara.

## Consequências

- Variação criada por qualquer caminho, hoje ou amanhã, já tem código.
  Custo: uma regra fora do TypeScript, documentada aqui e guardada por
  teste de texto na migração.
- O Zebra Browser Print é a ponte com a impressora pelo navegador; sem ele,
  o PDF na medida exata funciona com o driver de qualquer marca (Elgin
  incluída). Comando nativo da Elgin (PPLA/PPLB) fica para quando houver uma
  em mãos para medir.
- Separação por bipe (etapa 3) nasce em cima disto: conferência no
  navegador contra a lista do pedido, gravação em segundo plano e segunda
  tranca no servidor.
