-- Meta mensal por vendedor + limite configurável do alerta de estoque
ALTER TABLE "User" ADD COLUMN "monthlyGoal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Company" ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;
