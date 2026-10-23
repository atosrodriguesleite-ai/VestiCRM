-- RN-092: módulo Calendário comercial (chave por loja, só gerência).
-- As datas do sistema são CALCULADAS por regra; aqui moram só as datas que a
-- loja cria e a anotação (notas, tarefas, antecedência, lembrete) de uma
-- data do sistema num ano.
ALTER TABLE "Company" ADD COLUMN "calendarioEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "calendarioAntecedenciaDias" INTEGER NOT NULL DEFAULT 45;
ALTER TABLE "Company" ADD COLUMN "calendarioSegmentos" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "calendarioOcultas" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "calendarioAvisoRunAt" TIMESTAMP(3);

CREATE TYPE "CalendarioTipo" AS ENUM ('COMERCIAL', 'OPORTUNIDADE', 'LANCAMENTO');

CREATE TABLE "CalendarioEvento" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "tipo" "CalendarioTipo" NOT NULL,
  "titulo" TEXT NOT NULL,
  "data" TIMESTAMP(3) NOT NULL,
  "antecedenciaDias" INTEGER,
  "notas" TEXT NOT NULL DEFAULT '',
  "chaveSistema" TEXT,
  "ano" INTEGER,
  "avisadoEm" TIMESTAMP(3),
  "criadoPorNome" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarioEvento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CalendarioEvento_companyId_chaveSistema_ano_key" ON "CalendarioEvento"("companyId", "chaveSistema", "ano");
CREATE INDEX "CalendarioEvento_companyId_data_idx" ON "CalendarioEvento"("companyId", "data");
ALTER TABLE "CalendarioEvento" ADD CONSTRAINT "CalendarioEvento_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CalendarioTarefa" (
  "id" TEXT NOT NULL,
  "eventoId" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "feita" BOOLEAN NOT NULL DEFAULT false,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "feitaPorNome" TEXT,
  "feitaEm" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarioTarefa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CalendarioTarefa_eventoId_idx" ON "CalendarioTarefa"("eventoId");
ALTER TABLE "CalendarioTarefa" ADD CONSTRAINT "CalendarioTarefa_eventoId_fkey" FOREIGN KEY ("eventoId") REFERENCES "CalendarioEvento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
