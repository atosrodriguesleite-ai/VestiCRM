-- CONTATOS POR DATA (achado da revisão da RN-088, 14/10/2026). A faixa "hoje"
-- do BI conta as clientes cadastradas hoje a cada 30 s por aba aberta, e a
-- linha de 12 meses (RN-087) e o painel (novos no mês) agrupam por createdAt —
-- Customer só tinha índice por (companyId), e o Postgres varria a loja inteira.
-- UMA instrução por arquivo: CONCURRENTLY não roda dentro de transação (RN de
-- migração, 10/09/2026).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Customer_companyId_createdAt_idx" ON "Customer"("companyId", "createdAt");
