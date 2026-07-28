import type { MessageMedia } from "@prisma/client";

/**
 * LEITURA DE UMA MENSAGEM DO WHATSAPP.
 *
 * O WhatsApp tem dezenas de formatos de mensagem, e a lista cresce a cada
 * atualização do aplicativo. A regra aqui é uma só:
 *
 *   NENHUMA MENSAGEM PODE SER DESCARTADA.
 *
 * Antes, o que o sistema não soubesse ler virava texto vazio e era jogado
 * fora em silêncio — a cliente mandava a localização da loja, um contato,
 * uma enquete, e no chat não aparecia nada. Pior: mensagem temporária e
 * "visualização única" EMBRULHAM a mensagem de verdade dentro delas, então
 * bastava a conversa estar com mensagens temporárias ligadas para TUDO
 * sumir.
 *
 * Agora: desembrulha o que vier embrulhado, entende os formatos comuns, e o
 * que sobrar vira uma bolha avisando que chegou algo — com o nome do tipo.
 * Melhor a loja ver "chegou uma mensagem que não consigo exibir" e abrir o
 * WhatsApp do que não ficar sabendo que a cliente falou.
 */

export type LeituraWA = {
  text: string;
  mediaType: MessageMedia;
  mimeFallback: string | null;
  fileName: string | null;
  /** true quando o conteúdo não foi reconhecido (a bolha é um aviso) */
  desconhecida?: boolean;
};

type Conteudo = Record<string, unknown>;

/**
 * Embrulhos: formatos que carregam a mensagem real lá dentro.
 * Desembrulhar é o que salva a conversa inteira quando a cliente liga
 * "mensagens temporárias" ou manda foto de visualização única.
 */
const EMBRULHOS = [
  "ephemeralMessage", // mensagens temporárias
  "viewOnceMessage", // visualização única
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage", // arquivo com legenda
  "editedMessage", // texto editado
  "protocolMessage", // alguns servidores aninham aqui
] as const;

/** Tira as camadas de embrulho até chegar no conteúdo de verdade. */
export function desembrulhar(msg: Conteudo | undefined, nivel = 0): Conteudo {
  if (!msg || nivel > 5) return msg ?? {};
  for (const chave of EMBRULHOS) {
    const dentro = msg[chave] as { message?: Conteudo } | undefined;
    if (dentro?.message) return desembrulhar(dentro.message, nivel + 1);
  }
  return msg;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Nome legível do tipo, para a bolha de aviso do que não foi reconhecido. */
function nomeDoTipo(msg: Conteudo): string | null {
  const chaves = Object.keys(msg).filter(
    (k) => k !== "messageContextInfo" && k !== "senderKeyDistributionMessage"
  );
  return chaves[0] ?? null;
}

export function lerMensagemWA(entrada: { message?: Conteudo } | undefined): LeituraWA {
  const msg = desembrulhar(entrada?.message);
  const simples = (text: string): LeituraWA => ({
    text,
    mediaType: "TEXT",
    mimeFallback: null,
    fileName: null,
  });

  // ---- texto ----
  const conversation = texto(msg.conversation);
  if (conversation) return simples(conversation);

  const ext = msg.extendedTextMessage as { text?: string } | undefined;
  if (texto(ext?.text)) return simples(texto(ext?.text));

  // ---- mídia ----
  const img = msg.imageMessage as { caption?: string; mimetype?: string } | undefined;
  if (img)
    return {
      text: texto(img.caption) || "[foto]",
      mediaType: "IMAGE",
      mimeFallback: img.mimetype ?? "image/jpeg",
      fileName: null,
    };

  // ptvMessage = o vídeo redondo (mensagem de vídeo curta)
  const vid = (msg.videoMessage ?? msg.ptvMessage) as
    | { caption?: string; mimetype?: string }
    | undefined;
  if (vid)
    return {
      text: texto(vid.caption) || "[vídeo]",
      mediaType: "VIDEO",
      mimeFallback: vid.mimetype ?? "video/mp4",
      fileName: null,
    };

  const aud = (msg.audioMessage ?? msg.ptvAudioMessage) as { mimetype?: string } | undefined;
  if (aud)
    return {
      text: "[áudio]",
      mediaType: "AUDIO",
      mimeFallback: aud.mimetype ?? "audio/ogg",
      fileName: null,
    };

  const doc = msg.documentMessage as { fileName?: string; mimetype?: string } | undefined;
  if (doc)
    return {
      text: `[arquivo] ${texto(doc.fileName)}`.trim(),
      mediaType: "DOCUMENT",
      mimeFallback: doc.mimetype ?? "application/octet-stream",
      fileName: texto(doc.fileName) || null,
    };

  const fig = msg.stickerMessage as { mimetype?: string } | undefined;
  if (fig)
    return {
      text: "[figurinha]",
      mediaType: "IMAGE",
      mimeFallback: fig.mimetype ?? "image/webp",
      fileName: null,
    };

  // ---- localização: vira link do mapa, que é o que a loja precisa ----
  const loc = (msg.locationMessage ?? msg.liveLocationMessage) as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;
  if (loc) {
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    const ativa = msg.liveLocationMessage ? " em tempo real" : "";
    const rotulo = texto(loc.name) || texto(loc.address);
    const link =
      lat != null && lng != null
        ? `https://maps.google.com/?q=${lat},${lng}`
        : "";
    return simples(
      [`[localização${ativa}]`, rotulo, link].filter(Boolean).join(" ").trim()
    );
  }

  // ---- contato compartilhado ----
  const cont = msg.contactMessage as { displayName?: string; vcard?: string } | undefined;
  if (cont) {
    const fone = /TEL[^:]*:([+\d\s()-]+)/i.exec(texto(cont.vcard))?.[1]?.trim();
    return simples(
      `[contato] ${texto(cont.displayName)}${fone ? ` — ${fone}` : ""}`.trim()
    );
  }
  const conts = msg.contactsArrayMessage as { contacts?: unknown[] } | undefined;
  if (conts) return simples(`[${conts.contacts?.length ?? 0} contatos compartilhados]`);

  // ---- enquete ----
  const enq = msg.pollCreationMessage as
    | { name?: string; options?: { optionName?: string }[] }
    | undefined;
  if (enq) {
    const ops = (enq.options ?? []).map((o) => texto(o.optionName)).filter(Boolean);
    return simples(
      `[enquete] ${texto(enq.name)}${ops.length ? `: ${ops.join(" · ")}` : ""}`.trim()
    );
  }
  if (msg.pollUpdateMessage) return simples("[voto em enquete]");

  // ---- reação (emoji numa mensagem) ----
  const rea = msg.reactionMessage as { text?: string } | undefined;
  if (rea) {
    const emoji = texto(rea.text);
    return simples(emoji ? `[reagiu ${emoji}]` : "[removeu a reação]");
  }

  // ---- a cliente clicou num botão / escolheu na lista ----
  const botao = msg.buttonsResponseMessage as { selectedDisplayText?: string } | undefined;
  if (texto(botao?.selectedDisplayText)) return simples(texto(botao?.selectedDisplayText));
  const lista = msg.listResponseMessage as
    | { title?: string; singleSelectReply?: { selectedRowId?: string } }
    | undefined;
  if (lista)
    return simples(
      texto(lista.title) || texto(lista.singleSelectReply?.selectedRowId) || "[escolha na lista]"
    );
  const tpl = msg.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined;
  if (texto(tpl?.selectedDisplayText)) return simples(texto(tpl?.selectedDisplayText));

  // ---- pagamento / pedido do WhatsApp ----
  if (msg.orderMessage) return simples("[pedido enviado pelo WhatsApp]");
  if (msg.paymentInviteMessage || msg.requestPaymentMessage)
    return simples("[cobrança pelo WhatsApp]");

  // ---- não reconhecido: AVISA, nunca descarta ----
  const tipo = nomeDoTipo(msg);
  if (!tipo) return { ...simples(""), desconhecida: true };
  return {
    text: `[mensagem não exibida aqui — abra o WhatsApp para ver] (${tipo})`,
    mediaType: "TEXT",
    mimeFallback: null,
    fileName: null,
    desconhecida: true,
  };
}
