-- RN-077: a sincronização automática da Jueri deixa rastro e retoma de onde
-- parou — quando tentou, a página pendente (catálogo grande vai em etapas)
-- e o último erro. Escrita à mão (ADR-001); colunas opcionais, só metadado.
ALTER TABLE "JueriConnection" ADD COLUMN "lastSyncTentativaEm" TIMESTAMP(3);
ALTER TABLE "JueriConnection" ADD COLUMN "lastSyncPagina" INTEGER;
ALTER TABLE "JueriConnection" ADD COLUMN "lastSyncErro" TEXT;

-- As fotos da Jueri acompanham a Jueri: a foto ganha a origem ("JUERI") e o
-- produto guarda a lista da última sincronização. Foto da Nuvemshop também é
-- link, por isso a marca — "começa com http" não separa as duas.
ALTER TABLE "ProductImage" ADD COLUMN "source" TEXT;
ALTER TABLE "Product" ADD COLUMN "jueriFotos" TEXT;

-- Produto que veio da Jueri e não é da Nuvemshop: os links que ele tem hoje
-- são da Jueri (a loja sobe data-URL). O produto que é das duas fica sem marca:
-- a primeira rodada só anota a lista e não mexe em foto nenhuma.
UPDATE "ProductImage" i SET "source" = 'JUERI'
  FROM "Product" p
  WHERE i."productId" = p.id AND p."jueriId" IS NOT NULL AND p."nuvemshopId" IS NULL
    AND i.url LIKE 'http%';
UPDATE "Product" p SET "jueriFotos" = sub.lista
  FROM (
    SELECT "productId", json_agg(url ORDER BY "order", id)::text AS lista
    FROM "ProductImage" WHERE "source" = 'JUERI' GROUP BY "productId"
  ) sub
  WHERE sub."productId" = p.id;
