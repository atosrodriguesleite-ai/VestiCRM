-- Código curto e amigável para o link rastreado do catálogo
-- (cada linha existente e nova ganha um código aleatório de 7 caracteres)
ALTER TABLE "Customer"
  ADD COLUMN "linkCode" TEXT DEFAULT substr(md5((random())::text || (clock_timestamp())::text), 1, 7);

CREATE UNIQUE INDEX "Customer_linkCode_key" ON "Customer"("linkCode");
