import { Prisma } from "@prisma/client";
import { db } from "../db";
import { layoutEmbalagem, lerOpcoes, OPCOES_PADRAO, type Modelo, type OpcoesEmbalagem } from "./modelo";

/**
 * O MODELO PADRÃO DA LOJA (RN-059): nasce na primeira vez que alguém precisa
 * dele (imprimir ou abrir Configurações), com as opções padrão; a loja muda
 * tamanho e campos em Configurações → Etiquetas. Semeadura idempotente pelo
 * desenho da RN-031: o par (loja, tipo) com `padrao` é ÚNICO no banco
 * (índice parcial), então duas abas abrindo juntas esbarram no índice
 * (P2002 tratado) — nada é apagado depois (a primeira versão apagava o
 * "mais novo", que podia ser justamente o que a outra aba acabara de
 * editar; achado da revisão).
 */
export async function modeloPadraoDaLoja(
  companyId: string,
  tipo = "EMBALAGEM"
): Promise<{ id: string; nome: string; opcoes: OpcoesEmbalagem; modelo: Modelo }> {
  const ler = () => db.etiquetaModelo.findFirst({ where: { companyId, tipo, padrao: true } });
  let linha = await ler();
  if (!linha) {
    try {
      linha = await db.etiquetaModelo.create({
        data: {
          companyId,
          tipo,
          nome: "Embalagem padrão",
          larguraMm: OPCOES_PADRAO.larguraMm,
          alturaMm: OPCOES_PADRAO.alturaMm,
          padrao: true,
          opcoes: JSON.stringify(OPCOES_PADRAO),
        },
      });
    } catch (e) {
      // a outra aba chegou primeiro: vale a dela
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      linha = await ler();
      if (!linha) throw e;
    }
  }
  const opcoes = lerOpcoes(linha.opcoes);
  return { id: linha.id, nome: linha.nome, opcoes, modelo: layoutEmbalagem(opcoes) };
}

/** Grava as opções do modelo padrão (já validadas pela rota) e devolve o desenho novo. */
export async function salvarOpcoesDoPadrao(
  companyId: string,
  opcoes: OpcoesEmbalagem,
  tipo = "EMBALAGEM"
): Promise<Modelo> {
  const atual = await modeloPadraoDaLoja(companyId, tipo);
  // recorte por loja na própria escrita (RN-013); zero linhas = não gravou,
  // e dizer "salvo" sem gravar é o pior resultado possível
  const r = await db.etiquetaModelo.updateMany({
    where: { id: atual.id, companyId },
    data: { larguraMm: opcoes.larguraMm, alturaMm: opcoes.alturaMm, opcoes: JSON.stringify(opcoes) },
  });
  if (r.count === 0) throw new Error("O modelo de etiqueta não foi encontrado para salvar. Recarregue a página e tente de novo.");
  return layoutEmbalagem(opcoes);
}
