import crypto from "node:crypto";
import { db } from "./db";
import { VALIDADE_LINK_FICHA_MS, linkUtilizavel } from "./ficha-funcionario";

/**
 * LINK DO FORMULÁRIO DA FICHA (RN-025): o funcionário preenche a própria
 * ficha pelo celular, sem login — mesmo desenho do link de dados da cliente
 * (RN-024): código curto sorteado (64 bits), guardado no banco, vence em 7
 * dias. A diferença é o USO ÚNICO: ficha de RH tem CPF e conta bancária, o
 * link morre no envio — reaproveitar exige pedir outro ao admin.
 *
 * Arquivo próprio porque importa o banco — `ficha-funcionario.ts` é puro e
 * os testes o importam sem Prisma.
 */

/** Link novo para esta ficha — sorteado a cada clique, vence em 7 dias. */
export async function criarLinkFicha(
  funcionarioId: string,
  companyId: string
): Promise<string> {
  const code = crypto.randomBytes(8).toString("base64url"); // 11 caracteres
  await db.fichaFormLink.create({
    data: {
      companyId,
      funcionarioId,
      code,
      expiresAt: new Date(Date.now() + VALIDADE_LINK_FICHA_MS),
    },
  });
  // faxina de carona (sem cron, regra do CLAUDE.md): vencidos SEM resposta
  // vão embora — link usado fica, é o registro da conferência
  await db.fichaFormLink
    .deleteMany({
      where: { funcionarioId, usadoEm: null, expiresAt: { lt: new Date() } },
    })
    .catch(() => {});
  return code;
}

/** Lê o código do link — null se não existir, tiver vencido ou já foi usado. */
export async function lerLinkFicha(codigo: string) {
  const v = (codigo ?? "").trim();
  if (!v || v.length > 32) return null;
  const link = await db.fichaFormLink.findUnique({
    where: { code: v },
    include: {
      funcionario: {
        select: {
          id: true,
          companyId: true,
          nome: true,
          nascimento: true,
          cpf: true,
          telefone: true,
          email: true,
          zip: true,
          street: true,
          streetNumber: true,
          complement: true,
          district: true,
          city: true,
          state: true,
          chavePix: true,
          banco: true,
          agencia: true,
          conta: true,
          emergenciaNome: true,
          emergenciaParentesco: true,
          emergenciaTelefone: true,
          restricaoAlimentar: true,
          alergias: true,
          vinculo: true,
          desligamento: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  if (!link || !linkUtilizavel(link)) return null;
  // segurança extra (RN-013): o link nasce da ficha, mas confere a loja
  if (link.funcionario.companyId !== link.companyId) return null;
  return link;
}
