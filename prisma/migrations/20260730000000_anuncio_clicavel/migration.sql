-- O ANÚNCIO PASSA A SER CLICÁVEL
--
-- Quando a cliente chega por um Click-to-WhatsApp, o Meta manda junto a
-- prévia do anúncio (título, texto e link). O sistema extraía dela um CÓDIGO
-- curto e descartava o resto — sobrava "dbn-u8qsqk4" na tela: não abre nada e
-- não diz que anúncio é. Pior: o código é gravado em minúsculas, e link de
-- Instagram diferencia maiúsculas, então nem remontando dá para chegar lá.
--
-- Agora o criativo é guardado de verdade, uma linha por anúncio.

CREATE TABLE "AdCreative" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "adRef"       TEXT NOT NULL,
  "sourceUrl"   TEXT,
  "sourceId"    TEXT,
  "title"       TEXT,
  "body"        TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdCreative_companyId_adRef_key" ON "AdCreative"("companyId", "adRef");
CREATE INDEX "AdCreative_companyId_idx" ON "AdCreative"("companyId");

ALTER TABLE "AdCreative"
  ADD CONSTRAINT "AdCreative_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RESGATE DOS ANÚNCIOS QUE JÁ APARECERAM
--
-- O link foi descartado do cadastro, MAS sobreviveu num lugar: a nota interna
-- "📢 Cliente veio de um ANÚNCIO" que o sistema grava na conversa quando
-- detecta a origem. O endereço original está lá dentro, com as maiúsculas
-- intactas. Aqui ele é recuperado e ligado ao código da cliente.
--
-- Best-effort: anúncio sem nota (ou cuja nota não tinha link) simplesmente
-- não entra, e continua funcionando como antes.
INSERT INTO "AdCreative" ("id", "companyId", "adRef", "sourceUrl", "firstSeenAt", "lastSeenAt")
SELECT DISTINCT ON (cu."companyId", cu."adRef")
  substr(md5(random()::text || clock_timestamp()::text), 1, 25),
  cu."companyId",
  cu."adRef",
  substring(m."body" from 'https?://[^\s]+'),
  min(m."createdAt") OVER (PARTITION BY cu."companyId", cu."adRef"),
  max(m."createdAt") OVER (PARTITION BY cu."companyId", cu."adRef")
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
JOIN "Customer" cu ON cu."id" = c."customerId"
WHERE m."kind" = 'NOTE'
  AND m."body" LIKE '%veio de um ANÚNCIO%'
  AND cu."adRef" IS NOT NULL
  AND substring(m."body" from 'https?://[^\s]+') IS NOT NULL
ORDER BY cu."companyId", cu."adRef", m."createdAt" DESC;
