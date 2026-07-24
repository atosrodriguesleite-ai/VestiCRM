-- Mensagem personalizável de confirmação ao montar um pedido na inbox
ALTER TABLE "CommSettings" ADD COLUMN "orderMsg" TEXT;
