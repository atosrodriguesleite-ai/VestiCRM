-- Anúncio → campanha (Click-to-WhatsApp).
--
-- Quando o cliente chega clicando num anúncio do Instagram/Facebook, o
-- WhatsApp manda junto a prévia do anúncio. Guardamos o CÓDIGO desse anúncio
-- no cliente (adRef) e a lista de anúncios de cada campanha (adRefs), para a
-- campanha ser atribuída sozinha — e para responder "quanto cada anúncio deu".

ALTER TABLE "Customer" ADD COLUMN "adRef" TEXT;
ALTER TABLE "MarketingCampaign" ADD COLUMN "adRefs" TEXT;

CREATE INDEX "Customer_companyId_adRef_idx" ON "Customer"("companyId", "adRef");
