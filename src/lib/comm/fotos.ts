import { db } from "../db";
import { phoneMatchVariants } from "../intake";
import {
  evoFindContacts,
  evoProfilePicture,
  evolutionEnv,
  jidToPhone,
} from "./evolution";

/**
 * FOTO DE PERFIL DAS CLIENTES — a Central de Atendimento com a cara do
 * WhatsApp de verdade.
 *
 * Como funciona, e por que assim:
 *
 *  • Guardamos só o LINK que o próprio WhatsApp serve. A imagem nunca entra
 *    no nosso banco (foto no banco é a dívida técnica nº 1 do projeto, e
 *    seriam milhares de rostos).
 *  • Esse link VENCE. Por isso cada cliente tem a data da última conferida;
 *    passando da validade, o sistema busca de novo sozinho.
 *  • A busca é em LOTE: uma única chamada traz a agenda inteira do servidor
 *    com as fotos juntas. Só quem não aparecer nessa lista é consultado um a
 *    um — e com teto por rodada, para não virar rajada de chamadas no número
 *    (o que cheira a robô e é justamente o que a gente evita).
 *  • Cliente que escondeu a foto no WhatsApp fica sem link, e a tela mostra
 *    as iniciais coloridas. Isso é resposta, não erro: a data da conferida é
 *    gravada do mesmo jeito, para não ficarmos perguntando toda hora.
 */

/** Quanto tempo um link de foto vale antes de ser reconferido. */
export const FOTO_VALIDADE_DIAS = 7;

/** Quantas fotos individuais buscar por rodada (o lote não tem esse limite). */
export const FOTO_LIMITE_POR_RODADA = 40;

/** De quanto em quanto tempo uma loja pode rodar a varredura. */
export const FOTO_INTERVALO_MIN = 30;

/** Precisa conferir a foto desta cliente? */
export function precisaAtualizar(
  cliente: { photoSyncAt: Date | null },
  agora = new Date()
): boolean {
  if (!cliente.photoSyncAt) return true; // nunca conferimos
  const dias = (agora.getTime() - cliente.photoSyncAt.getTime()) / 86_400_000;
  return dias >= FOTO_VALIDADE_DIAS;
}

/**
 * Indexa a resposta do servidor por telefone. O formato varia conforme a
 * versão (id, remoteJid, profilePicUrl, profilePictureUrl) — lemos todos os
 * jeitos conhecidos em vez de apostar em um.
 */
export function indexarFotos(bruto: unknown): Map<string, string> {
  const mapa = new Map<string, string>();
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray((bruto as { contacts?: unknown[] })?.contacts)
      ? (bruto as { contacts: unknown[] }).contacts
      : [];
  for (const item of lista) {
    // a lista pode vir com buraco (null) ou com coisa que não é objeto —
    // resposta de servidor não se supõe bem-comportada
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const jid = String(c.remoteJid ?? c.id ?? c.jid ?? "");
    const foto = String(c.profilePicUrl ?? c.profilePictureUrl ?? c.picture ?? "");
    if (!jid || !foto.startsWith("http")) continue;
    const fone = jidToPhone(jid) ?? jid.replace(/\D/g, "");
    if (fone) mapa.set(fone, foto);
  }
  return mapa;
}

/** Acha a foto do telefone tolerando o 9º dígito (mesma régua do intake). */
export function fotoDoTelefone(
  mapa: Map<string, string>,
  telefone: string
): string | null {
  for (const v of phoneMatchVariants(telefone)) {
    const achou = mapa.get(v);
    if (achou) return achou;
  }
  return null;
}

/**
 * Atualiza as fotos das clientes da loja. Best-effort: qualquer tropeço no
 * servidor de WhatsApp é silencioso — foto é enfeite, não pode atrapalhar
 * atendimento.
 */
export async function sincronizarFotos(
  companyId: string,
  limite = FOTO_LIMITE_POR_RODADA
): Promise<{ conferidas: number; comFoto: number }> {
  if (!evolutionEnv().configured) return { conferidas: 0, comFoto: 0 };

  const settings = await db.commSettings.findUnique({
    where: { companyId },
    select: { evolutionInstance: true, evolutionStatus: true },
  });
  if (!settings?.evolutionInstance || settings.evolutionStatus !== "CONECTADO") {
    return { conferidas: 0, comFoto: 0 };
  }
  const instancia = settings.evolutionInstance;

  const vencidas = await db.customer.findMany({
    where: {
      companyId,
      OR: [
        { photoSyncAt: null },
        {
          photoSyncAt: {
            lt: new Date(Date.now() - FOTO_VALIDADE_DIAS * 86_400_000),
          },
        },
      ],
    },
    select: { id: true, phone: true },
    // as mais faladas primeiro: são as que aparecem na tela agora
    orderBy: { lastContactAt: { sort: "desc", nulls: "last" } },
    take: 400,
  });
  if (vencidas.length === 0) return { conferidas: 0, comFoto: 0 };

  // 1) o lote: uma chamada traz a agenda inteira com as fotos
  const contatos = await evoFindContacts(instancia);
  const mapa = contatos.ok ? indexarFotos(contatos.data) : new Map<string, string>();

  const agora = new Date();
  let comFoto = 0;
  let conferidas = 0;
  const semFotoNoLote: { id: string; phone: string }[] = [];

  for (const c of vencidas) {
    const url = fotoDoTelefone(mapa, c.phone);
    if (url) {
      await db.customer.update({
        where: { id: c.id },
        data: { photoUrl: url, photoSyncAt: agora },
      });
      comFoto++;
      conferidas++;
    } else {
      semFotoNoLote.push(c);
    }
  }

  // 2) o que faltou: consulta individual, com teto por rodada
  for (const c of semFotoNoLote.slice(0, limite)) {
    const r = await evoProfilePicture(instancia, c.phone);
    const url = r.ok ? (r.data?.profilePictureUrl ?? null) : null;
    await db.customer.update({
      where: { id: c.id },
      // sem foto também grava a data: cliente que esconde a foto não pode
      // fazer o sistema perguntar de novo a cada abertura de tela
      data: { photoUrl: url && url.startsWith("http") ? url : null, photoSyncAt: agora },
    });
    if (url) comFoto++;
    conferidas++;
  }

  return { conferidas, comFoto };
}

/**
 * Varredura com freio: no máximo uma por loja a cada `FOTO_INTERVALO_MIN`.
 * Chamada de carona no sync da inbox, DEPOIS da resposta — a tela nunca
 * espera por foto.
 */
const ultimaRodada = new Map<string, number>();

export async function sincronizarFotosSeDevido(companyId: string) {
  const agora = Date.now();
  const ultima = ultimaRodada.get(companyId) ?? 0;
  if (agora - ultima < FOTO_INTERVALO_MIN * 60_000) return;
  ultimaRodada.set(companyId, agora);
  try {
    await sincronizarFotos(companyId);
  } catch {
    // foto é enfeite: falhar aqui não pode aparecer para ninguém
  }
}
