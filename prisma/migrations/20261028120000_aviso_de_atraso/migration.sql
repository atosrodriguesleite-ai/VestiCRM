-- RN-103: o aviso de pacote atrasado/parado sai UMA vez por pacote; o
-- carimbo diz quando saiu (nulo = ainda não avisou).
ALTER TABLE "Shipping" ADD COLUMN "atrasoAvisadoEm" TIMESTAMP(3);

-- O QUE JÁ ESTÁ ATRASADO HOJE É PONTO DE PARTIDA, NÃO AVISO: sem isto, o
-- primeiro deploy mandava um aviso para cada pacote que a loja já vê como
-- "parado" há semanas (a lição da RN-100: ligar a regra numa loja grande não
-- cria uma enxurrada). O carimbo entra como "avisado agora"; o que atrasar
-- DAQUI em diante avisa. A régua é a de "parado" de antes (7 dias), que
-- cobre também quem tem previsão vencida há mais tempo.
UPDATE "Shipping"
SET "atrasoAvisadoEm" = NOW()
WHERE "meStatus" = 'POSTADO'
  AND "deliveredAt" IS NULL
  AND "shippedAt" IS NOT NULL
  AND "shippedAt" < NOW() - INTERVAL '7 days';
