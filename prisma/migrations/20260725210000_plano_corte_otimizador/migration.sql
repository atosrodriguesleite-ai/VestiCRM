-- Plano de Corte vira job de otimização retomável: rodadas de cálculo com
-- estado salvo (barra de progresso, cronômetro, fila de até 3 por loja) e
-- suporte a vários modelos no mesmo plano (modelId passa a ser opcional).

ALTER TABLE "CutPlanRun" ALTER COLUMN "modelId" DROP NOT NULL;
ALTER TABLE "CutPlanRun" ADD COLUMN "name" TEXT;
ALTER TABLE "CutPlanRun" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CONCLUIDO';
ALTER TABLE "CutPlanRun" ADD COLUMN "mode" TEXT;
ALTER TABLE "CutPlanRun" ADD COLUMN "budgetMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CutPlanRun" ADD COLUMN "elapsedMs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CutPlanRun" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CutPlanRun" ADD COLUMN "state" TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS "CutPlanRun_companyId_idx";
CREATE INDEX "CutPlanRun_companyId_status_idx" ON "CutPlanRun"("companyId", "status");
