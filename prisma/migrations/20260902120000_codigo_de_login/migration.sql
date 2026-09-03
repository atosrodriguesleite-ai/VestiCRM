-- RN-045: código de login pelo WhatsApp em aparelho novo (opt-in por loja).
ALTER TABLE "Company" ADD COLUMN "loginCodeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "loginPhone" TEXT;

CREATE TABLE "LoginCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "tries" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginCode_userId_idx" ON "LoginCode"("userId");
CREATE INDEX "LoginCode_expiresAt_idx" ON "LoginCode"("expiresAt");
ALTER TABLE "LoginCode" ADD CONSTRAINT "LoginCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
