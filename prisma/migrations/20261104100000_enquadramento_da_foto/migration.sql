-- RN-107 · Enquadramento da foto do produto: a janela 3:4 (em frações da
-- foto) que o card do catálogo e o PDF obedecem. Coluna nova e vazia — a
-- foto nunca é recortada de verdade, e sem janela vale o corte de sempre.
ALTER TABLE "ProductImage" ADD COLUMN IF NOT EXISTS "enquadramento" JSONB;
