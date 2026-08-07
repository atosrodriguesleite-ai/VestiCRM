-- Pedido do catálogo guarda a SESSÃO de navegação que o gerou (Tracking
-- Engine). É o que permite à Inteligência somar FATURAMENTO PAGO de verdade
-- por canal/campanha — antes o ranking somava valor de sacola enviada (não
-- paga, vinda do navegador) rotulado de "faturamento" (auditoria 06/08/2026).
ALTER TABLE "Order" ADD COLUMN "trackSessionId" TEXT;
CREATE INDEX "Order_companyId_trackSessionId_idx" ON "Order"("companyId", "trackSessionId");
