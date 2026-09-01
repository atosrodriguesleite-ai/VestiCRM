import { db } from "../db";
import { evoGetMediaBase64 } from "./evolution";

/**
 * RN-028 · O ARQUIVO DA CLIENTE NÃO SE PERDE.
 *
 * O webhook do WhatsApp avisa que existe uma foto/áudio/documento, mas não
 * manda o arquivo: ele precisa ser buscado no servidor de conexão. Antes, o
 * webhook BAIXAVA primeiro e só então gravava a mensagem — e isso tinha dois
 * buracos por onde mensagem de cliente sumia:
 *
 *  1. O LOTE ESTOURAVA O TEMPO DA FUNÇÃO. A cliente manda dez fotos de uma
 *     vez (ou um documento grande e lento). Cada download podia levar até 45
 *     segundos, e a função tinha 30 no total: a Vercel matava a execução no
 *     meio, e TODAS as mensagens que ainda não tinham sido gravadas sumiam —
 *     sem bolha, sem registro, sem rastro, porque nem o registro de erro
 *     chegava a rodar.
 *  2. FALHOU UMA VEZ, PERDEU PARA SEMPRE. Servidor ocupado, arquivo ainda em
 *     processamento, uma instabilidade de rede: o download voltava vazio, a
 *     bolha virava um texto seco e NINGUÉM tentava de novo.
 *
 * A ordem agora é outra: a mensagem NASCE PRIMEIRO (a conversa nunca perde a
 * bolha) e o arquivo é marcado como pendente. O download é tentado logo em
 * seguida, dentro de um orçamento de tempo; o que não couber — ou o que
 * falhar — fica na fila e é repescado depois, de carona no tráfego do app
 * (nunca um cron novo: ADR-002).
 *
 * A régua é a premissa do produto: se a cliente mandou, tem que chegar.
 */

/**
 * Teto do arquivo guardado na conversa (~12 MB de arquivo real, que em
 * base64 ocupa um terço a mais).
 *
 * Existe por causa da dívida técnica nº 1: a mídia mora como data-URL DENTRO
 * do banco. Acima disso o arquivo não é engolido em silêncio — a bolha diz
 * que ele não chegou e o caso vai para a Central de Comunicação da loja, com
 * o nome do arquivo, para alguém buscar no celular.
 */
export const MEDIA_BASE64_MAX = 16 * 1024 * 1024;

/**
 * Tempo máximo de UM download.
 *
 * Curto de propósito: quem espera é a fila, não a função. O valor antigo
 * (45s) era maior que a própria vida da função do webhook (30s) — ou seja,
 * um único arquivo lento matava a execução inteira.
 */
export const MS_BUSCA_MIDIA = 12_000;

/**
 * Orçamento de download DENTRO do webhook.
 *
 * O webhook tem 60s. Reservar 25s para arquivos deixa folga larga para
 * gravar as mensagens do lote — que é o que não pode faltar. Estourou o
 * orçamento, o resto do lote vai para a fila em vez de morrer no meio.
 */
export const MS_ORCAMENTO_MIDIA_WEBHOOK = 25_000;

/**
 * Quanto esperar antes de tentar de novo, por número de tentativas já feitas.
 *
 * Começa perto (o motivo mais comum é o servidor ainda estar processando o
 * arquivo, coisa de segundos) e vai afastando. O total cobre ~10 horas: o
 * servidor de conexão não guarda mídia para sempre, então insistir por dias
 * seria teatro.
 */
const ESPERA_POR_TENTATIVA_MS = [
  60_000, // 1 min
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
];

export const MAX_TENTATIVAS_MIDIA = ESPERA_POR_TENTATIVA_MS.length;

/** Quantos arquivos uma rodada de repesca tenta (a rodada pega carona). */
export const MIDIAS_POR_RODADA = 3;

/** Intervalo mínimo entre duas rodadas de repesca (trava global). */
export const MS_ENTRE_REPESCAS = 60_000;

/**
 * Orçamento de uma RODADA de repesca.
 *
 * A rodada roda de carona, depois da resposta da inbox (`after`), mas ainda
 * dentro da vida da função. Sem orçamento, três arquivos travados gastavam 36s
 * e a rodada podia ser cortada no meio — e como a trava é tomada ANTES do
 * trabalho, o minuto inteiro ia embora sem repescar nada (achado da revisão,
 * 31/08/2026). Agora a rodada só começa um download que cabe no que sobrou.
 */
export const MS_ORCAMENTO_REPESCA = 30_000;

/** Quando tentar de novo, dado o número de tentativas JÁ feitas. */
export function proximaTentativa(tentativasFeitas: number, agora = new Date()): Date | null {
  const espera = ESPERA_POR_TENTATIVA_MS[tentativasFeitas - 1];
  if (espera === undefined) return null; // acabaram as tentativas
  return new Date(agora.getTime() + espera);
}

/**
 * Tipo esperado do arquivo, por tipo de mídia.
 *
 * O servidor de conexão nem sempre devolve o `mimetype`. Sem este palpite, a
 * foto repescada virava `application/octet-stream` — e a rota de mídia serve
 * isso como ARQUIVO PARA BAIXAR (com `nosniff`), então a bolha ficava
 * quebrada para sempre. O caminho do webhook já mandava esse palpite; a
 * repesca não (achado da revisão, 31/08/2026).
 */
export function mimeEsperado(mediaType: string | null | undefined): string | null {
  switch (mediaType) {
    case "IMAGE":
      return "image/jpeg";
    case "AUDIO":
      return "audio/ogg";
    case "VIDEO":
      return "video/mp4";
    default:
      return null; // documento: o tipo real é o do arquivo, não dá para chutar
  }
}

/** Extensão do teto em MB, para a mensagem de erro falar humano. */
const emMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

type ResultadoBusca =
  | { ok: true; dataUrl: string }
  | { ok: false; motivo: string; desistir: boolean };

/**
 * Busca o arquivo no servidor de conexão e monta a data-URL.
 *
 * `desistir` diz que insistir não adianta (arquivo grande demais para caber
 * aqui) — é diferente de "não deu agora", que merece nova tentativa.
 */
export async function buscarArquivo(
  instance: string,
  externalId: string,
  mimeFallback?: string | null
): Promise<ResultadoBusca> {
  const res = await evoGetMediaBase64(instance, externalId, MS_BUSCA_MIDIA);
  const b64 = res.data?.base64;
  if (!res.ok || !b64) {
    return {
      ok: false,
      motivo: res.incerto
        ? "o servidor de WhatsApp demorou demais para entregar o arquivo"
        : `o servidor de WhatsApp não entregou o arquivo (código ${res.status})`,
      desistir: false,
    };
  }
  if (b64.length > MEDIA_BASE64_MAX) {
    return {
      ok: false,
      motivo: `arquivo grande demais para guardar no sistema (${emMB(b64.length)} MB; o limite é ${emMB(MEDIA_BASE64_MAX)} MB) — abra o WhatsApp para vê-lo`,
      desistir: true,
    };
  }
  const mime = res.data?.mimetype || mimeFallback || "application/octet-stream";
  return { ok: true, dataUrl: `data:${mime.split(";")[0]};base64,${b64}` };
}

/**
 * Tenta completar UMA mensagem com o arquivo dela.
 *
 * Devolve `true` quando o arquivo chegou. Quando não chegou, adia (ou
 * desiste, se já esgotou as tentativas) — mas NUNCA lança: nenhuma falha de
 * arquivo pode derrubar quem chamou (webhook ou repesca).
 */
export async function completarMidia(msg: {
  id: string;
  externalId: string | null;
  mediaTries: number;
  fileName?: string | null;
  instance: string | null;
  companyId: string;
  mimeFallback?: string | null;
}): Promise<boolean> {
  try {
    // SEM ID DA MENSAGEM não há o que buscar — isso não melhora com o tempo.
    if (!msg.externalId) {
      await desistirDaMidia(msg, "a mensagem não trouxe o identificador do arquivo");
      return false;
    }
    // SEM CONEXÃO é TEMPORÁRIO, e por isso não pode virar desistência.
    //
    // Desconectar e reconectar o WhatsApp zera a instância da loja por alguns
    // minutos (`disconnect/route.ts`). Tratar isso como "não vai chegar mais"
    // fazia a repesca desistir de TODOS os arquivos pendentes de uma vez, sem
    // gastar uma tentativa sequer — e as bolhas diziam "o arquivo não chegou"
    // para sempre. Seria exatamente o buraco que esta regra existe para matar
    // (achado da revisão, 31/08/2026).
    const r: ResultadoBusca = msg.instance
      ? await buscarArquivo(msg.instance, msg.externalId, msg.mimeFallback)
      : {
          ok: false,
          motivo: "a loja está sem conexão de WhatsApp no momento",
          desistir: false,
        };
    if (r.ok) {
      await db.message.update({
        where: { id: msg.id },
        data: {
          mediaUrl: r.dataUrl,
          mediaPending: false,
          mediaError: null,
          mediaNextTryAt: null,
        },
      });
      // ACORDA O SYNC: a inbox de 3 em 3s só entrega conversa cujo
      // `updatedAt` mudou. Sem tocar a conversa, o arquivo repescado ficava
      // gravado no banco e invisível na tela até alguém recarregar a página
      // — a mesma lição da edição, da reação e do apagar.
      await db.message
        .findUnique({ where: { id: msg.id }, select: { conversationId: true } })
        .then((m) =>
          m
            ? db.conversation.update({
                where: { id: m.conversationId },
                data: { updatedAt: new Date() },
              })
            : null
        )
        .catch(() => {});
      return true;
    }
    const tentativas = msg.mediaTries + 1;
    const proxima = r.desistir ? null : proximaTentativa(tentativas);
    if (!proxima) {
      await desistirDaMidia({ ...msg, mediaTries: tentativas }, r.motivo);
      return false;
    }
    await db.message.update({
      where: { id: msg.id },
      data: {
        mediaPending: true,
        mediaTries: tentativas,
        mediaError: r.motivo,
        mediaNextTryAt: proxima,
      },
    });
    return false;
  } catch {
    // falha inesperada (banco, rede): deixa na fila para a próxima rodada
    return false;
  }
}

/**
 * Acabaram as tentativas — o arquivo não vai chegar.
 *
 * Sai da fila (senão a repesca ficaria batendo nele para sempre) mas NÃO
 * some: a bolha passa a dizer que o arquivo não chegou, e o caso fica
 * registrado no painel de Saúde com o nome do arquivo. É a única forma
 * honesta de fechar o assunto — silêncio aqui seria exatamente o defeito que
 * esta regra existe para matar.
 */
async function desistirDaMidia(
  msg: { id: string; companyId: string; fileName?: string | null; mediaTries: number },
  motivo: string
): Promise<void> {
  await db.message
    .update({
      where: { id: msg.id },
      data: {
        mediaPending: false,
        mediaTries: msg.mediaTries,
        mediaError: motivo,
        mediaNextTryAt: null,
      },
    })
    .catch(() => {});
  await db.commEvent
    .create({
      data: {
        companyId: msg.companyId,
        channel: "WHATSAPP",
        direction: "IN",
        type: "midia.nao-chegou",
        status: "ERRO",
        error: `Um arquivo enviado pela cliente não pôde ser baixado: ${motivo}.`,
        payload: JSON.stringify({
          mensagem: msg.id,
          arquivo: msg.fileName ?? null,
          tentativas: msg.mediaTries,
        }),
      },
    })
    .catch(() => {});
  // DE PROPÓSITO, NÃO usa `logServerError` aqui.
  //
  // Aquele caminho consome a trava única de 15 minutos do push "🚨 Erro em
  // produção": um arquivo vencido (banal, e que a loja já vê na Central)
  // silenciaria o alarme de uma falha de verdade na mesma janela — como uma
  // mensagem que não conseguiu ser gravada. O registro acima é o lugar
  // certo: quem precisa saber que o anexo não chegou é a LOJA, não o
  // plantão da plataforma (achado da revisão, 31/08/2026).
}

/**
 * REPESCA — de carona no tráfego, nunca num cron novo (ADR-002).
 *
 * Roda no máximo uma vez por minuto no sistema inteiro (trava atômica igual à
 * do vigia) e tenta poucos arquivos por rodada: a inbox consulta de 3 em 3
 * segundos, então "pouco e sempre" dá centenas de tentativas por hora sem
 * pesar em nada. Nunca lança — é seguro chamar de qualquer rota.
 */
export async function repescarMidiasPendentes(): Promise<number> {
  try {
    const agora = new Date();
    await db.systemHealth
      .createMany({ data: [{ id: "main" }], skipDuplicates: true })
      .catch(() => {});
    const claimed = await db.systemHealth.updateMany({
      where: {
        id: "main",
        OR: [
          { midiaRunAt: null },
          { midiaRunAt: { lt: new Date(agora.getTime() - MS_ENTRE_REPESCAS) } },
        ],
      },
      data: { midiaRunAt: agora },
    });
    if (claimed.count === 0) return 0;

    const pendentes = await db.message.findMany({
      where: {
        mediaPending: true,
        OR: [{ mediaNextTryAt: null }, { mediaNextTryAt: { lte: agora } }],
      },
      select: {
        id: true,
        externalId: true,
        mediaTries: true,
        mediaType: true,
        fileName: true,
        conversation: { select: { companyId: true } },
      },
      // MAIS ANTIGA PRIMEIRO: quem está esperando há mais tempo tem
      // prioridade, e o arquivo antigo é justamente o que corre risco de
      // sumir do servidor de conexão.
      orderBy: { createdAt: "asc" },
      take: MIDIAS_POR_RODADA,
    });
    if (pendentes.length === 0) return 0;

    // a instância é por loja: lê uma vez cada, mesmo com várias mensagens
    const instancias = new Map<string, string | null>();
    let chegaram = 0;
    const inicioDaRodada = Date.now();
    for (const p of pendentes) {
      // só começa um download que cabe inteiro no que sobrou da rodada
      if (Date.now() - inicioDaRodada + MS_BUSCA_MIDIA > MS_ORCAMENTO_REPESCA) break;
      const companyId = p.conversation.companyId;
      if (!instancias.has(companyId)) {
        const s = await db.commSettings.findUnique({
          where: { companyId },
          select: { evolutionInstance: true },
        });
        instancias.set(companyId, s?.evolutionInstance ?? null);
      }
      const ok = await completarMidia({
        id: p.id,
        externalId: p.externalId,
        mediaTries: p.mediaTries,
        fileName: p.fileName,
        companyId,
        instance: instancias.get(companyId) ?? null,
        mimeFallback: mimeEsperado(p.mediaType),
      });
      if (ok) chegaram += 1;
    }
    return chegaram;
  } catch {
    return 0; // repesca é um extra: nunca pode atrapalhar quem deu a carona
  }
}
