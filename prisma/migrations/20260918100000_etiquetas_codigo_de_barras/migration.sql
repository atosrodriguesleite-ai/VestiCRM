-- MÓDULO ETIQUETAS (RN-059, ADR-017), 18/09/2026. Escrita à mão (ADR-001).
--
-- 1) chave do módulo por loja (nasce desligada: nada muda para quem não tem)
ALTER TABLE "Company" ADD COLUMN "etiquetasEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 2) o código de barras da variação
ALTER TABLE "ProductVariant" ADD COLUMN "barcode" TEXT;

-- 3) a sequência única da plataforma e a função que vira EAN-13 interno:
--    prefixo 2 (faixa 20-29 do GS1, uso interno) + 11 dígitos da sequência +
--    dígito verificador. A conta do dígito é a do padrão EAN-13 (posições
--    ímpares pesam 1, pares pesam 3, contando da esquerda nos 12 dígitos).
--    A MESMA conta existe em TypeScript (lib/etiquetas/ean13.ts) e o script
--    scripts/confere-codigo-de-barras.ts prova que as duas concordam.
CREATE SEQUENCE IF NOT EXISTS "ProductVariant_barcode_seq" START 1;

CREATE OR REPLACE FUNCTION ean13_interno(n BIGINT) RETURNS TEXT AS $$
DECLARE
  base TEXT;
  soma INT := 0;
  i INT;
  d INT;
BEGIN
  -- a MESMA faixa do TypeScript: acima de 11 dígitos o lpad truncaria em
  -- silêncio e voltaria a gerar código já usado (achado da revisão)
  IF n < 0 OR n > 99999999999 THEN
    RAISE EXCEPTION 'ean13_interno: número fora da faixa (%)', n;
  END IF;
  base := '2' || lpad(n::text, 11, '0');
  FOR i IN 1..12 LOOP
    d := substr(base, i, 1)::int;
    IF i % 2 = 1 THEN soma := soma + d; ELSE soma := soma + d * 3; END IF;
  END LOOP;
  RETURN base || ((10 - (soma % 10)) % 10)::text;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 4) o GATILHO: toda variação nasce com código, venha de onde vier (ficha,
--    Nuvemshop, Jueri, importação, produção). Regra no banco de propósito
--    (ADR-017): são cinco caminhos de criação no código, e "esqueceu um" é
--    exatamente a classe de defeito que já custou caro aqui. O código nunca é
--    reescrito depois (só INSERT).
CREATE OR REPLACE FUNCTION productvariant_barcode_padrao() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."barcode" IS NULL OR NEW."barcode" = '' THEN
    NEW."barcode" := ean13_interno(nextval('"ProductVariant_barcode_seq"'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ProductVariant_barcode_trg" ON "ProductVariant";
CREATE TRIGGER "ProductVariant_barcode_trg"
  BEFORE INSERT ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION productvariant_barcode_padrao();

-- 5) as variações que já existem ganham código agora
UPDATE "ProductVariant"
   SET "barcode" = ean13_interno(nextval('"ProductVariant_barcode_seq"'))
 WHERE "barcode" IS NULL;

-- 6) único na plataforma (tabela pequena: índice normal, sem CONCURRENTLY)
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");

-- 7) modelos de etiqueta da loja
CREATE TABLE "EtiquetaModelo" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "nome"      TEXT NOT NULL,
  "tipo"      TEXT NOT NULL DEFAULT 'EMBALAGEM',
  "larguraMm" DOUBLE PRECISION NOT NULL,
  "alturaMm"  DOUBLE PRECISION NOT NULL,
  "padrao"    BOOLEAN NOT NULL DEFAULT false,
  "opcoes"    TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EtiquetaModelo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EtiquetaModelo_companyId_tipo_idx" ON "EtiquetaModelo"("companyId", "tipo");
-- UM modelo padrão por (loja, tipo): duas abas semeando juntas esbarram aqui
-- (P2002 tratado em lib/etiquetas/modelos.ts), nunca em dois padrões
CREATE UNIQUE INDEX "EtiquetaModelo_padrao_key" ON "EtiquetaModelo"("companyId", "tipo") WHERE "padrao";
ALTER TABLE "EtiquetaModelo"
  ADD CONSTRAINT "EtiquetaModelo_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
