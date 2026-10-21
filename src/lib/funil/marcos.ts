import { db } from "../db";
import type { Marco } from "./etapas-regra";

/**
 * RN-091 · PARA QUAL ETAPA O SISTEMA MOVE O CARTÃO SOZINHO.
 *
 * Fonte ÚNICA: a tabela `EtapaAutomatica`. Antes cada lugar procurava a etapa
 * pelo NOME ("Catálogo enviado", "Pagamento pendente"...) e renomear a coluna
 * fazia o funil parar de andar sem aviso — o defeito que impedia a loja de
 * editar o próprio funil. Sem linha para o marco = "não mover" (decisão da
 * loja, nunca um palpite pelo nome).
 */

export type EtapaDoMarco = {
  id: string;
  name: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
};

export async function etapaDoMarco(
  companyId: string,
  marco: Marco,
  /** só deste funil (a loja tem um só hoje; com mais, a ordem é por funil) */
  pipelineId?: string
): Promise<EtapaDoMarco | null> {
  const v = await db.etapaAutomatica.findFirst({
    where: { marco, pipeline: { companyId }, ...(pipelineId ? { pipelineId } : {}) },
    // a loja tem um funil só hoje; com mais, a resposta não pode depender
    // da ordem em que o Postgres devolve as linhas
    orderBy: { pipelineId: "asc" },
    select: {
      stage: { select: { id: true, name: true, order: true, isWon: true, isLost: true } },
    },
  });
  return v?.stage ?? null;
}

/** Todas as etapas ligadas ao marco (uma por funil da loja). */
export async function idsDasEtapasDoMarco(companyId: string, marco: Marco): Promise<string[]> {
  const vs = await db.etapaAutomatica.findMany({
    where: { marco, pipeline: { companyId } },
    select: { stageId: true },
  });
  return vs.map((v) => v.stageId);
}

/**
 * REPARO DE CARONA (roda ao abrir o Funil): funil SEM NENHUM vínculo numa
 * loja que NÃO tem o editor ligado ganha os vínculos pela régua antiga do
 * nome — a mesma da migração 20261021100000. Quem cai aqui é a loja criada
 * pelo código antigo durante a janela do deploy (ver ADR-020): sem isso o
 * funil dela ficaria parado para sempre, em silêncio. Com o editor ligado,
 * "nenhum vínculo" pode ser escolha da loja ("não mover" nos quatro) e
 * nada é tocado. Um comando só; sem nada a fazer, não insere nada.
 */
export async function garantirMarcosIniciais(companyId: string): Promise<void> {
  try {
    await db.$executeRaw`
      INSERT INTO "EtapaAutomatica" ("id", "pipelineId", "marco", "stageId")
      SELECT DISTINCT ON (s."pipelineId", m.marco)
             'ea' || md5(s."id" || m.marco), s."pipelineId", m.marco, s."id"
      FROM "Stage" s
      JOIN "Pipeline" p ON p.id = s."pipelineId"
      JOIN "Company" c ON c.id = p."companyId"
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
      WHERE p."companyId" = ${companyId}
        AND NOT c."funilEditavelEnabled"
        AND NOT s."isWon" AND NOT s."isLost"
        AND NOT EXISTS (SELECT 1 FROM "EtapaAutomatica" ea WHERE ea."pipelineId" = s."pipelineId")
      ORDER BY s."pipelineId", m.marco, s."order" ASC, s."id" ASC
      ON CONFLICT DO NOTHING`;
  } catch {
    /* funil nunca derruba a tela */
  }
}
