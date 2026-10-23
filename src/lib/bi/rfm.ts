/**
 * O RFM DO BI — a leitura do banco (RN-092). A regra mora em `rfm-regra.ts`
 * (pura); aqui só se busca o que ela precisa, UMA consulta agregada no banco
 * para a loja inteira — uma linha por cliente, nunca os pedidos um a um.
 *
 * A população é a MESMA da carteira (RN-084): pedido pago COM data de
 * pagamento (RN-001), valor vendido sem o frete (`netTotal`, RN-002), de
 * cliente da loja (RN-013). O e2e confere que o RFM e a aba Recompra contam
 * as mesmas compradoras.
 */
import { db } from "../db";
import { PAID_ORDER_STATUSES } from "../orders";
import {
  DIAS_DA_JANELA,
  calcularRfm,
  matrizDoRfm,
  resumirRfm,
  type BaseDoRfm,
  type ClienteRfm,
  type MatrizDoRfm,
  type ResumoDoRfm,
} from "./rfm-regra";

const DIA_MS = 86_400_000;

/** o que a LISTA precisa de cada cliente além da conta: quem é, se dá para chamar, de quem é a carteira */
export type ContatoDoRfm = {
  nome: string;
  telefone: string;
  bloqueada: boolean;
  /** o código curto do link pessoal (`?c=`), ou o id */
  codigo: string;
  /** a dona da carteira, se ativa (a venda pelo link da mensagem é dela, RN-005) */
  dona: { nome: string; role: string } | null;
};

export type ClienteDaLista = ClienteRfm & ContatoDoRfm;

/**
 * Por cliente: compras e valor da vida, a última compra e os últimos 12
 * meses — agregado no banco —, com o contato e a dona na MESMA consulta (a
 * lista não faz segunda ida e não perde linha entre uma e outra).
 */
export async function carregarBaseDoRfm(companyId: string, agora = new Date()): Promise<(BaseDoRfm & ContatoDoRfm)[]> {
  const desde = new Date(agora.getTime() - DIAS_DA_JANELA * DIA_MS);
  const linhas = await db.$queryRaw<
    {
      id: string;
      compras: number;
      ltv: number | null;
      ultima: Date;
      compras12: number;
      valor12: number | null;
      nome: string;
      telefone: string | null;
      bloqueada: Date | null;
      codigo: string | null;
      donaNome: string | null;
      donaRole: string | null;
    }[]
  >`
    SELECT o."customerId" AS id,
           c."name" AS nome,
           c."phone" AS telefone,
           c."blockedAt" AS bloqueada,
           c."linkCode" AS codigo,
           u."name" AS "donaNome",
           u."role"::text AS "donaRole",
           COUNT(*)::int AS compras,
           SUM(o."netTotal")::float AS ltv,
           MAX(o."paidAt") AS ultima,
           (COUNT(*) FILTER (WHERE o."paidAt" >= ${desde}))::int AS compras12,
           (SUM(o."netTotal") FILTER (WHERE o."paidAt" >= ${desde}))::float AS valor12
    FROM "Order" o
    JOIN "Customer" c ON c."id" = o."customerId" AND c."companyId" = ${companyId}
    LEFT JOIN "User" u ON u."id" = c."ownerId" AND u."companyId" = ${companyId} AND u."active"
    WHERE o."companyId" = ${companyId}
      AND o."paidAt" IS NOT NULL
      AND o."status" = ANY(${[...PAID_ORDER_STATUSES]}::text[]::"OrderStatus"[])
    GROUP BY o."customerId", c."id", u."id"
  `;
  return linhas.map((l) => ({
    id: l.id,
    compras: l.compras,
    ltv: l.ltv ?? 0,
    ultimaCompra: l.ultima,
    compras12: l.compras12,
    valor12: l.valor12 ?? 0,
    nome: l.nome,
    telefone: l.telefone ?? "",
    bloqueada: !!l.bloqueada,
    codigo: l.codigo ?? l.id,
    dona: l.donaNome && l.donaRole ? { nome: l.donaNome, role: l.donaRole } : null,
  }));
}

export type Rfm = {
  resumo: ResumoDoRfm;
  matriz: MatrizDoRfm;
};

/** O RFM da loja: o resumo por grupo e a matriz (a lista de clientes fica para a lista do BI). */
export async function montarRfm(companyId: string, agora = new Date()): Promise<Rfm> {
  const clientes = calcularRfm(await carregarBaseDoRfm(companyId, agora), agora);
  return { resumo: resumirRfm(clientes), matriz: matrizDoRfm(clientes) };
}

/** As clientes com notas, grupo e contato (a lista do BI filtra). */
export async function clientesDoRfm(companyId: string, agora = new Date()): Promise<ClienteDaLista[]> {
  return calcularRfm(await carregarBaseDoRfm(companyId, agora), agora);
}
