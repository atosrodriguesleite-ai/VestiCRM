/**
 * NOME DO ARQUIVO NA HORA DE SALVAR uma mídia da conversa.
 *
 * "Não estou conseguindo salvar as fotos e vídeos enviados e recebidos nas
 * conversas" (26/08/2026). Documento chega com nome próprio; foto, vídeo e
 * áudio não chegam com nome nenhum — e sem nome o navegador salva como
 * "media", sem extensão, e o arquivo não abre em nada.
 *
 * Barra, dois-pontos e afins saem do nome: o Windows recusa o arquivo inteiro
 * por causa de um caractere desses no meio.
 */
export function nomeDoArquivo(
  fileName: string | null | undefined,
  mediaType: string | null | undefined,
  mime: string
): string {
  const limpo = (fileName ?? "").trim().replace(/[/\\:*?"<>|]/g, "-");
  if (limpo) return limpo;
  // o "subtipo" do mime vira a extensão, com os apelidos que o Windows
  // entende. A troca é por tipo INTEIRO, nunca por pedaço: trocar "mpeg" solto
  // fazia `video/mpeg` virar `video.mp3` (achado da revisão).
  const APELIDOS: Record<string, string> = {
    jpeg: "jpg",
    quicktime: "mov",
    "x-m4a": "m4a",
    mp4: "mp4",
    "3gpp": "3gp",
    svg__xml: "svg",
  };
  const sub = (mime.split("/")[1] ?? "").split(";")[0].trim().toLowerCase();
  const audioMpeg = mime.startsWith("audio/") && sub === "mpeg";
  const bruto = audioMpeg ? "mp3" : (APELIDOS[sub.replace("+", "__")] ?? APELIDOS[sub] ?? sub);
  // subtipo comprido de documento (planilha, apresentação) não vira extensão:
  // "arquivo.vnd.openxmlformats-…" não abre em nada
  const ext = /^[a-z0-9]{1,5}$/.test(bruto) ? bruto : "bin";
  const base =
    mediaType === "IMAGE"
      ? "foto"
      : mediaType === "VIDEO"
        ? "video"
        : mediaType === "AUDIO"
          ? "audio"
          : "arquivo";
  return `${base}.${ext}`;
}

/** Endereço para SALVAR a mídia de uma mensagem no aparelho. */
export function linkParaSalvar(mediaUrl: string): string {
  // mídia nossa (`/api/messages/<id>/media`) ganha a chave `baixar=1`, que
  // faz o servidor mandar como arquivo em vez de abrir na tela
  if (!mediaUrl.startsWith("/api/messages/")) return mediaUrl;
  return `${mediaUrl}${mediaUrl.includes("?") ? "&" : "?"}baixar=1`;
}
