-- Plano de Corte Inteligente: modelos importados do CAD (Audaces .adsx/DXF)
-- e planos de corte gerados (riscos otimizados + enfesto), por loja.

CREATE TABLE "CutPlanModel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "thumbnail" TEXT,
    "sizes" TEXT NOT NULL,
    "pieces" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CutPlanModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CutPlanRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CutPlanRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CutPlanModel_companyId_idx" ON "CutPlanModel"("companyId");
CREATE INDEX "CutPlanRun_companyId_idx" ON "CutPlanRun"("companyId");
CREATE INDEX "CutPlanRun_modelId_idx" ON "CutPlanRun"("modelId");

ALTER TABLE "CutPlanModel" ADD CONSTRAINT "CutPlanModel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CutPlanRun" ADD CONSTRAINT "CutPlanRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CutPlanRun" ADD CONSTRAINT "CutPlanRun_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CutPlanModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
