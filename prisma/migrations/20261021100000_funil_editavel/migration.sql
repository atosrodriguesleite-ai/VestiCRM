-- FUNIL EDITÁVEL (RN-091, 21/10/2026). Escrita à mão (ADR-001): o diff do
-- Prisma traz lixo de drift (linkCode, defaults de updatedAt) que NÃO entra.

-- A chave da loja: nasce desligada, super admin liga.
ALTER TABLE "Company" ADD COLUMN "funilEditavelEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Para qual etapa o sistema move o cartão sozinho em cada marco.
CREATE TABLE "EtapaAutomatica" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "marco" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    CONSTRAINT "EtapaAutomatica_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EtapaAutomatica_stageId_idx" ON "EtapaAutomatica"("stageId");
CREATE UNIQUE INDEX "EtapaAutomatica_pipelineId_marco_key" ON "EtapaAutomatica"("pipelineId", "marco");
ALTER TABLE "EtapaAutomatica" ADD CONSTRAINT "EtapaAutomatica_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EtapaAutomatica" ADD CONSTRAINT "EtapaAutomatica_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PREENCHIMENTO: até hoje a etapa era achada pelo NOME (funil-auto.ts,
-- lista NOMES, comparação sem acento e sem caixa). Aqui a MESMA régua vira
-- linha, para que nenhuma loja perceba diferença no dia da troca: cada funil
-- ganha o vínculo que o nome já dava, na etapa ABERTA de menor ordem que
-- casa (era a primeira que o código achava). Etapa de ganho/perda nunca é
-- alvo de marco (o editor também recusa).
INSERT INTO "EtapaAutomatica" ("id", "pipelineId", "marco", "stageId")
SELECT DISTINCT ON (s."pipelineId", m.marco)
       'ea' || md5(s."id" || m.marco), s."pipelineId", m.marco, s."id"
FROM "Stage" s
JOIN (VALUES
  ('PRIMEIRO_CONTATO', 'primeiro contato'),
  ('PRIMEIRO_CONTATO', 'em conversa'),
  ('PRIMEIRO_CONTATO', 'contato realizado'),
  ('CATALOGO_ENVIADO', 'catalogo enviado'),
  ('CATALOGO_ENVIADO', 'enviou catalogo'),
  ('NEGOCIACAO', 'pedido em negociacao'),
  ('NEGOCIACAO', 'negociando'),
  ('NEGOCIACAO', 'negociacao'),
  ('PAGAMENTO', 'pagamento pendente'),
  ('PAGAMENTO', 'aguardando pagamento')
) AS m(marco, nome)
  ON translate(lower(btrim(s."name")), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = m.nome
WHERE NOT s."isWon" AND NOT s."isLost"
ORDER BY s."pipelineId", m.marco, s."order" ASC, s."id" ASC;
