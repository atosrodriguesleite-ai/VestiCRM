-- Plano de Corte vira módulo separado (pago à parte): chave por loja,
-- ligada/desligada pelo Super Admin no painel Lojas.

ALTER TABLE "Company" ADD COLUMN "cutPlanEnabled" BOOLEAN NOT NULL DEFAULT false;
