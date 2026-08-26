-- MENU DA CONVERSA (pedido do dono, 26/08/2026): clique direito no computador
-- e toque longo no celular abrem fixar/desfixar, marcar como não lida,
-- favoritar e bloquear — como no aplicativo do WhatsApp.
--
-- Fixada e favorita são da CONVERSA (a Central é compartilhada: o que a loja
-- fixa vale para quem quer que abra a tela).
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "favorite" BOOLEAN NOT NULL DEFAULT false;

-- Bloqueio é da PESSOA, e só é marcado aqui depois que o WhatsApp aceita.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "blockedAt" TIMESTAMP(3);

-- a lista mostra as fixadas no topo
CREATE INDEX IF NOT EXISTS "Conversation_companyId_pinned_idx" ON "Conversation"("companyId", "pinned");
