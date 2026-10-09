-- RN-078 · Peça sem cor se chama "Único".
-- A sincronização da Jueri gravava a cor VAZIA na variação de produto sem
-- cor, e a cor vazia derrubava o pedido do catálogo público (400) e o
-- salvamento da ficha da peça. Renomeia para "Único", o nome que o resto do
-- sistema já usa — sem tocar na variação que colidiria com uma "Único" já
-- existente do mesmo produto e tamanho (o único de produto × cor × tamanho);
-- essa continua casando pela porta do pedido, que trata "" e "Único" como a
-- mesma cor. "Vazia" inclui tab, quebra de linha e o espaço invisível
-- (nbsp) — a mesma régua do trim do código.
UPDATE "ProductVariant" v
SET "color" = 'Único'
WHERE v."id" IN (
    -- uma por produto × tamanho: "" e " " no mesmo produto colidiriam entre
    -- si, e migração que falha PARA todos os deploys seguintes (P3009)
    SELECT DISTINCT ON ("productId", "size") "id"
    FROM "ProductVariant"
    WHERE btrim("color", E' \t\r\n\u00A0') = ''
    ORDER BY "productId", "size", ("color" = '') DESC, "id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ProductVariant" o
    WHERE o."productId" = v."productId"
      AND o."size" = v."size"
      AND o."color" = 'Único'
  );
