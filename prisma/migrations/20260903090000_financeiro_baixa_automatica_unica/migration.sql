-- UMA PARCELA, UMA BAIXA AUTOMÁTICA VIVA (RN-033).
--
-- A porta única de entrada das vendas dá a baixa do que FALTA quando o pedido
-- vira PAGO. Duas chamadas simultâneas — o PATCH do pedido e o aviso do
-- gateway chegam juntos — liam o mesmo saldo e cada uma criava a sua baixa:
-- a venda de R$ 100 entrava R$ 200 na conta. O índice parcial abaixo faz o
-- BANCO recusar a segunda (P2002 tratado), que é a mesma trava que já segura
-- a conta padrão e a conta fixa do mês.
--
-- Antes do índice, o que já está no banco precisa virar UMA baixa por
-- parcela. E o dinheiro não pode mudar de valor no caminho: duas automáticas
-- vivas nem sempre são a duplicata da corrida — podem ser R$ 70 + R$ 30 de
-- uma venda de R$ 100 cujo sinal à mão foi estornado. Então elas são
-- SOMADAS na mais antiga, com um teto: o que a parcela ainda deve depois das
-- baixas feitas à mão. Assim o caso legítimo fica inteiro (70+30 = 100) e a
-- duplicata da corrida volta ao certo (70+70 numa parcela de 70 vira 70).
-- Primeiro SOLTA A CONCILIAÇÃO das parcelas que vão mudar (RN-037): linha do
-- banco "conferida" contra dinheiro que voltou atrás — ou que passou a valer
-- outro valor — faria a conferência do mês fechar com um erro impossível de
-- achar. Vai antes dos UPDATEs, que é enquanto dá para saber quais são.
DELETE FROM "FinOfxVinculo" v
 USING "FinBaixa" b
 WHERE v."baixaId" = b."id"
   AND b."autorNome" = 'Sistema'
   AND b."estornadaEm" IS NULL
   AND b."parcelaId" IN (
         SELECT "parcelaId" FROM "FinBaixa"
          WHERE "autorNome" = 'Sistema' AND "estornadaEm" IS NULL
          GROUP BY "parcelaId" HAVING COUNT(*) > 1
       );

WITH vivas AS (
  SELECT b."id",
         b."parcelaId",
         ROW_NUMBER() OVER (PARTITION BY b."parcelaId" ORDER BY b."createdAt", b."id") AS ordem,
         COUNT(*)     OVER (PARTITION BY b."parcelaId") AS quantas,
         SUM(b."valor") OVER (PARTITION BY b."parcelaId") AS soma
    FROM "FinBaixa" b
   WHERE b."autorNome" = 'Sistema' AND b."estornadaEm" IS NULL
)
UPDATE "FinBaixa" b
   SET "valor" = GREATEST(0, LEAST(
         v.soma,
         p."valor" - COALESCE((
           SELECT SUM(m."valor") FROM "FinBaixa" m
            WHERE m."parcelaId" = p."id"
              AND m."estornadaEm" IS NULL
              AND m."autorNome" <> 'Sistema'
         ), 0)
       ))
  FROM vivas v
  JOIN "FinParcela" p ON p."id" = v."parcelaId"
 WHERE b."id" = v."id" AND v.ordem = 1 AND v.quantas > 1;

-- as demais saem de cena. Baixa errada se ESTORNA, nunca se apaga (RN-030):
-- o registro de que aconteceu fica.
WITH vivas AS (
  SELECT b."id",
         ROW_NUMBER() OVER (PARTITION BY b."parcelaId" ORDER BY b."createdAt", b."id") AS ordem
    FROM "FinBaixa" b
   WHERE b."autorNome" = 'Sistema' AND b."estornadaEm" IS NULL
)
UPDATE "FinBaixa" b
   SET "estornadaEm" = NOW(), "estornoAutor" = 'Sistema'
  FROM vivas v
 WHERE b."id" = v."id" AND v.ordem > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "FinBaixa_parcelaId_automatica_key"
    ON "FinBaixa"("parcelaId")
 WHERE "estornadaEm" IS NULL AND "autorNome" = 'Sistema';
