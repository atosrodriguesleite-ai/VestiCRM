import { Prisma } from "@prisma/client";
import { db } from "../db";
import {
  layoutPorTipo,
  lerOpcoes,
  modeloDaLinhaGravada,
  opcoesIniciais,
  OPCOES_PADRAO,
  TETO_MODELO_BYTES,
  type Modelo,
  type OpcoesEmbalagem,
  type TipoDeEtiqueta,
} from "./modelo";

const NOME_PADRAO: Record<TipoDeEtiqueta, string> = {
  EMBALAGEM: "Embalagem padrão",
  COMPOSICAO: "Composição padrão",
  ENVIO: "Envio padrão",
};

export type ModeloResumo = {
  id: string;
  nome: string;
  tipo: TipoDeEtiqueta;
  larguraMm: number;
  alturaMm: number;
  colunas: number;
  espacoMm: number;
  girada: boolean;
  padrao: boolean;
  /** desenhado no editor (true) ou por regra (false) */
  editado: boolean;
  updatedAt: Date;
};

const tipoDe = (t: string): TipoDeEtiqueta => (t === "COMPOSICAO" || t === "ENVIO" ? t : "EMBALAGEM");

function resumo(l: {
  id: string; nome: string; tipo: string; larguraMm: number; alturaMm: number; colunas: number;
  espacoMm: number; girada: boolean; padrao: boolean; elementos: string | null; updatedAt: Date;
}): ModeloResumo {
  return {
    id: l.id, nome: l.nome, tipo: tipoDe(l.tipo), larguraMm: l.larguraMm, alturaMm: l.alturaMm,
    colunas: l.colunas, espacoMm: l.espacoMm, girada: l.girada, padrao: l.padrao,
    editado: !!l.elementos, updatedAt: l.updatedAt,
  };
}

/**
 * O MODELO PADRÃO DA LOJA para um tipo (RN-059): nasce na primeira vez que
 * alguém precisa dele, com o desenho por regra do tipo; a loja edita no
 * editor. Semeadura idempotente pelo desenho da RN-031: o par (loja, tipo)
 * com `padrao` é ÚNICO no banco (índice parcial), então duas abas semeando
 * juntas esbarram no índice (P2002 tratado) — nada é apagado depois.
 */
export async function modeloPadraoDaLoja(
  companyId: string,
  tipo: TipoDeEtiqueta = "EMBALAGEM"
): Promise<{ id: string; nome: string; opcoes: OpcoesEmbalagem; modelo: Modelo }> {
  const ler = () => db.etiquetaModelo.findFirst({ where: { companyId, tipo, padrao: true, arquivadoEm: null } });
  let linha = await ler();
  if (!linha) {
    const op = opcoesIniciais(tipo);
    const desenho = layoutPorTipo(tipo, op);
    try {
      linha = await db.etiquetaModelo.create({
        data: {
          companyId,
          tipo,
          nome: NOME_PADRAO[tipo],
          larguraMm: op.larguraMm,
          alturaMm: op.alturaMm,
          colunas: desenho.colunas,
          espacoMm: desenho.espacoMm,
          girada: desenho.girada,
          padrao: true,
          opcoes: JSON.stringify(op),
        },
      });
    } catch (e) {
      // a outra aba chegou primeiro: vale a dela
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      linha = await ler();
      if (!linha) throw e;
    }
  }
  return { id: linha.id, nome: linha.nome, opcoes: lerOpcoes(linha.opcoes), modelo: modeloDaLinhaGravada(linha) };
}

/** Um modelo pelo id (da loja; arquivado não imprime), pronto para desenhar. */
export async function modeloDaLoja(
  companyId: string,
  id: string
): Promise<{ id: string; nome: string; tipo: TipoDeEtiqueta; modelo: Modelo } | null> {
  const l = await db.etiquetaModelo.findFirst({ where: { id, companyId, arquivadoEm: null } });
  return l ? { id: l.id, nome: l.nome, tipo: tipoDe(l.tipo), modelo: modeloDaLinhaGravada(l) } : null;
}

/** Os modelos vivos da loja (os três padrões nascem se ainda não existirem). */
export async function listarModelos(companyId: string): Promise<ModeloResumo[]> {
  await Promise.all((["EMBALAGEM", "COMPOSICAO", "ENVIO"] as TipoDeEtiqueta[]).map((t) => modeloPadraoDaLoja(companyId, t)));
  const linhas = await db.etiquetaModelo.findMany({
    where: { companyId, arquivadoEm: null },
    orderBy: [{ tipo: "asc" }, { padrao: "desc" }, { nome: "asc" }],
  });
  return linhas.map(resumo);
}

/** O modelo inteiro para o editor: resumo + desenho atual + as opções por regra. */
export async function abrirModelo(companyId: string, id: string) {
  const l = await db.etiquetaModelo.findFirst({ where: { id, companyId, arquivadoEm: null } });
  if (!l) return null;
  return { ...resumo(l), opcoes: lerOpcoes(l.opcoes), modelo: modeloDaLinhaGravada(l) };
}

/** Modelo novo: nasce com o desenho por regra do tipo (ou copiando outro). */
export async function criarModelo(
  companyId: string,
  entrada: { nome: string; tipo: TipoDeEtiqueta; copiarDe?: string }
): Promise<ModeloResumo> {
  const origem = entrada.copiarDe
    ? await db.etiquetaModelo.findFirst({ where: { id: entrada.copiarDe, companyId } })
    : null;
  const op = origem ? lerOpcoes(origem.opcoes) : opcoesIniciais(entrada.tipo);
  const desenho = origem ? modeloDaLinhaGravada(origem) : layoutPorTipo(entrada.tipo, op);
  const l = await db.etiquetaModelo.create({
    data: {
      companyId,
      tipo: origem ? origem.tipo : entrada.tipo,
      nome: entrada.nome,
      larguraMm: desenho.larguraMm,
      alturaMm: desenho.alturaMm,
      colunas: desenho.colunas,
      espacoMm: desenho.espacoMm,
      girada: desenho.girada,
      padrao: false,
      opcoes: JSON.stringify(op ?? OPCOES_PADRAO),
      // cópia leva o desenho como está (do editor ou o por regra congelado)
      elementos: origem ? JSON.stringify(desenho.elementos) : null,
    },
  });
  return resumo(l);
}

export type EdicaoDoModelo = {
  nome?: string;
  larguraMm?: number;
  alturaMm?: number;
  colunas?: number;
  espacoMm?: number;
  girada?: boolean;
  /** a lista do editor (já validada pela rota); null volta ao desenho por regra */
  elementos?: string | null;
};

/** Salva o modelo (recorte por loja na própria escrita, RN-013). */
export async function salvarModelo(companyId: string, id: string, edicao: EdicaoDoModelo): Promise<ModeloResumo | null> {
  if (edicao.elementos && edicao.elementos.length > TETO_MODELO_BYTES) {
    throw new Error("O modelo ficou grande demais (imagens pesadas). Use imagens menores.");
  }
  const r = await db.etiquetaModelo.updateMany({
    where: { id, companyId, arquivadoEm: null },
    data: {
      ...(edicao.nome !== undefined ? { nome: edicao.nome } : {}),
      ...(edicao.larguraMm !== undefined ? { larguraMm: edicao.larguraMm } : {}),
      ...(edicao.alturaMm !== undefined ? { alturaMm: edicao.alturaMm } : {}),
      ...(edicao.colunas !== undefined ? { colunas: edicao.colunas } : {}),
      ...(edicao.espacoMm !== undefined ? { espacoMm: edicao.espacoMm } : {}),
      ...(edicao.girada !== undefined ? { girada: edicao.girada } : {}),
      ...(edicao.elementos !== undefined ? { elementos: edicao.elementos } : {}),
    },
  });
  if (r.count === 0) return null;
  const l = await db.etiquetaModelo.findFirst({ where: { id, companyId } });
  return l ? resumo(l) : null;
}

/**
 * DEFINIR COMO PADRÃO do tipo: numa transação, o padrão atual deixa de ser e
 * este passa a ser — o índice parcial garante que nunca há dois.
 */
export async function definirPadrao(companyId: string, id: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const alvo = await tx.etiquetaModelo.findFirst({ where: { id, companyId, arquivadoEm: null } });
    if (!alvo) return false;
    if (alvo.padrao) return true;
    await tx.etiquetaModelo.updateMany({ where: { companyId, tipo: alvo.tipo, padrao: true }, data: { padrao: false } });
    await tx.etiquetaModelo.update({ where: { id: alvo.id }, data: { padrao: true } });
    return true;
  });
}

/**
 * ARQUIVAR: some da lista e não imprime, mas a linha fica (histórico). O
 * padrão do tipo não se arquiva — defina outro como padrão antes.
 */
export async function arquivarModelo(companyId: string, id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const l = await db.etiquetaModelo.findFirst({ where: { id, companyId, arquivadoEm: null } });
  if (!l) return { ok: false, erro: "Modelo não encontrado." };
  if (l.padrao) return { ok: false, erro: "Este é o modelo padrão do tipo. Defina outro como padrão antes de arquivar." };
  await db.etiquetaModelo.updateMany({ where: { id, companyId }, data: { arquivadoEm: new Date() } });
  return { ok: true };
}

/** Composição por categoria: a lista da loja e a gravação (vazio apaga). */
export async function composicoesPorCategoria(companyId: string): Promise<{ category: string; composition: string }[]> {
  return db.composicaoCategoria.findMany({ where: { companyId }, select: { category: true, composition: true }, orderBy: { category: "asc" } });
}

export async function salvarComposicaoDaCategoria(companyId: string, category: string, composition: string): Promise<void> {
  const texto = composition.trim();
  if (!texto) {
    await db.composicaoCategoria.deleteMany({ where: { companyId, category } });
    return;
  }
  await db.composicaoCategoria.upsert({
    where: { companyId_category: { companyId, category } },
    create: { companyId, category, composition: texto },
    update: { composition: texto },
  });
}
