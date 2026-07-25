-- Vigia do sistema: registro de erros + estado do watchdog + alerta por loja

CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "path" TEXT,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

CREATE TABLE "SystemHealth" (
    "id" TEXT NOT NULL,
    "watchdogRunAt" TIMESTAMP(3),
    "evolutionOk" BOOLEAN NOT NULL DEFAULT true,
    "evolutionDownSince" TIMESTAMP(3),
    "errorAlertAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SystemHealth_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CommSettings" ADD COLUMN "evolutionDownSince" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN "evolutionAlertAt" TIMESTAMP(3);
