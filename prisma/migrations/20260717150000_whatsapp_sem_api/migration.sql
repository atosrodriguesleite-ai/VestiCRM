-- WhatsApp sem API oficial (Evolution): conexão por loja + trava anti-banimento
ALTER TABLE "CommSettings" ADD COLUMN "evolutionInstance" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "evolutionWebhookToken" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "evolutionStatus" TEXT NOT NULL DEFAULT 'DESCONECTADO';
ALTER TABLE "CommSettings" ADD COLUMN "evolutionPhone" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "waLastSentAt" TIMESTAMP(3);
ALTER TABLE "CommSettings" ADD COLUMN "waSentDate" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "waSentToday" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "CommSettings_evolutionWebhookToken_key" ON "CommSettings"("evolutionWebhookToken");

-- Aceite do termo de uso (prova permanente: quem, quando, IP, versão do texto)
CREATE TABLE "WhatsappConsent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "termVersion" TEXT NOT NULL,
    "termSha" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsappConsent_companyId_idx" ON "WhatsappConsent"("companyId");
ALTER TABLE "WhatsappConsent" ADD CONSTRAINT "WhatsappConsent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
