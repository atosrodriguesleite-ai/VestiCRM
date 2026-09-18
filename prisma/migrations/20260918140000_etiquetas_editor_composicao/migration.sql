-- Módulo Etiquetas, área própria com editor de modelos e etiqueta de
-- composição (pedido do dono, 18/09/2026). Escrita à mão (ADR-001).
ALTER TABLE "Product" ADD COLUMN "composition" TEXT;

ALTER TABLE "EtiquetaModelo" ADD COLUMN "colunas" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "EtiquetaModelo" ADD COLUMN "espacoMm" DOUBLE PRECISION NOT NULL DEFAULT 2;
ALTER TABLE "EtiquetaModelo" ADD COLUMN "girada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EtiquetaModelo" ADD COLUMN "elementos" TEXT;
ALTER TABLE "EtiquetaModelo" ADD COLUMN "arquivadoEm" TIMESTAMP(3);

-- os modelos que já existiam guardavam colunas e giro dentro do JSON de
-- opções: passam para as colunas de verdade (a linha é quem manda agora).
-- O JSON é lido por uma função que devolve NULL em texto torto — um
-- registro inválido NÃO pode derrubar a migração e parar todos os deploys
-- (P3009, regra operacional nº 2)
CREATE OR REPLACE FUNCTION etiqueta_opcoes_jsonb(t TEXT) RETURNS JSONB AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "EtiquetaModelo" SET
  "colunas"  = GREATEST(1, LEAST(6, COALESCE(NULLIF((etiqueta_opcoes_jsonb("opcoes")->>'colunas'), '')::numeric, 1)))::int,
  "espacoMm" = GREATEST(0, COALESCE(NULLIF((etiqueta_opcoes_jsonb("opcoes")->>'espacoMm'), '')::numeric, 2)),
  "girada"   = CASE
                 WHEN (etiqueta_opcoes_jsonb("opcoes")->>'girar') = 'sim' THEN true
                 WHEN (etiqueta_opcoes_jsonb("opcoes")->>'girar') = 'nao' THEN false
                 ELSE "alturaMm" > "larguraMm"
               END
WHERE etiqueta_opcoes_jsonb("opcoes") IS NOT NULL;

DROP FUNCTION etiqueta_opcoes_jsonb(TEXT);

CREATE TABLE "ComposicaoCategoria" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "composition" TEXT NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComposicaoCategoria_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComposicaoCategoria_companyId_category_key" ON "ComposicaoCategoria"("companyId", "category");
ALTER TABLE "ComposicaoCategoria"
  ADD CONSTRAINT "ComposicaoCategoria_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
