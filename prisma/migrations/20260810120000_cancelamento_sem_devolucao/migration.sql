-- CANCELAMENTO SEM DEVOLUÇÃO DE ESTOQUE (pedido das lojas).
--
-- Ao cancelar um pedido, o vendedor passa a escolher: as peças voltam ao
-- catálogo (comportamento de sempre) ou NÃO voltam (perda, brinde, defeito —
-- baixa em definitivo).
--
-- `stockWrittenOff` marca o pedido cancelado que NÃO devolveu as peças.
-- Sem essa marca, reabrir o pedido descontaria o estoque uma segunda vez
-- pelas mesmas peças — com ela, reabrir apenas "recola" a baixa original no
-- pedido (o líquido do livro de movimentos continua positivo, então um novo
-- cancelamento COM devolução devolve exatamente o que saiu).

ALTER TABLE "Order" ADD COLUMN "stockWrittenOff" BOOLEAN NOT NULL DEFAULT false;
