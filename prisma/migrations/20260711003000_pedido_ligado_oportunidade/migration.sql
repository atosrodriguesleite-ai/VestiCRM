-- Vínculo 1-para-1 entre pedido e oportunidade do funil (criados juntos
-- pelo catálogo). Excluir um passa a apagar o outro.
ALTER TABLE "Order" ADD COLUMN "opportunityId" TEXT;

CREATE UNIQUE INDEX "Order_opportunityId_key" ON "Order"("opportunityId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
