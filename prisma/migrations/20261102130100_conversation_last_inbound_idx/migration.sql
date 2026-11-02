-- RN-105: o vigia lê, a cada rodada, a última mensagem recebida de cada loja
-- conectada (MAX de lastInboundAt por companyId). Sem este índice era uma
-- varredura da tabela inteira por loja. UMA instrução por arquivo: CONCURRENTLY
-- não roda dentro de transação (CLAUDE.md, regra 2).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Conversation_companyId_lastInboundAt_idx" ON "Conversation"("companyId", "lastInboundAt");
