/**
 * O QUE O SISTEMA ACEITA COMO FOTO — e como uma foto sai para o navegador.
 *
 * INCIDENTE QUE CRIOU ESTE ARQUIVO (auditoria de segurança, 29/08/2026):
 * a foto de produto entrava como TEXTO LIVRE (`z.string()`) e saía com o
 * tipo de arquivo que vinha escrito no próprio texto. A cadeia toda:
 *
 *   1. qualquer pessoa logada cadastrava um "produto" cuja foto era
 *      `data:text/html;base64,<página com script>`;
 *   2. `/api/img/<id>` é PÚBLICA e devolvia `Content-Type: text/html`;
 *   3. o resultado era uma página do atacante servida em
 *      www.atacadopro.com — com cache de 1 ano e cara de link nosso.
 *
 * O estrago não é técnico, é de confiança: o golpista manda esse endereço
 * no WhatsApp, a lojista vê o nosso domínio, abre, e a página pede a senha
 * dela ou dispara comandos aproveitando que ela está logada.
 *
 * A DEFESA MORA NA SAÍDA, não na entrada. Trancar só o cadastro deixaria
 * de fora tudo o que JÁ está gravado e as outras portas por onde foto
 * entra (importação de catálogo, Nuvemshop, Jueri). Por isso a régua é
 * uma só e a última palavra é de quem SERVE o arquivo: fora da lista,
 * nada é entregue como página — vira download inerte.
 *
 * SVG fica DE FORA da lista de propósito: é o único formato de imagem que
 * carrega programação dentro. Nenhuma foto de peça de roupa é SVG.
 */

/**
 * Mensagem de recusa. Genérica ("Dados inválidos") a lojista não entende:
 * ela só vê o cadastro falhar e não descobre que o problema é a FOTO.
 */
export const ERRO_DE_FOTO =
  "Foto em formato não aceito. Use JPG, PNG, WebP, GIF ou AVIF.";

/** Formatos que o sistema entrega como imagem. Lista FECHADA. */
export const TIPOS_DE_IMAGEM = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  // Os de baixo quase não aparecem no cadastro, mas APARECEM em foto
  // importada de site antigo — e o catálogo guarda o tipo da origem. Fora
  // da lista, a foto viraria download e SUMIRIA da vitrine, com cache de um
  // ano fixando o estrago. Nenhum deles carrega programação (ao contrário
  // do SVG), então entram. `bmp` é o mesmo que a mídia do WhatsApp aceita.
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
] as const;

/** Apelidos que aparecem na vida real e valem pelo tipo de verdade. */
const APELIDOS: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/x-png": "image/png",
};

/**
 * Normaliza o tipo declarado e devolve `null` se ele não estiver na lista.
 * Recebe o texto cru (pode vir com `; charset=…` ou em maiúsculas).
 */
export function tipoDeImagem(mime: string | null | undefined): string | null {
  if (!mime) return null;
  const limpo = mime.split(";")[0].trim().toLowerCase();
  const real = APELIDOS[limpo] ?? limpo;
  return (TIPOS_DE_IMAGEM as readonly string[]).includes(real) ? real : null;
}

/**
 * A URL de foto que chega de fora é aceitável?
 *
 * Três formatos são legítimos e cada um é conferido no seu tempo:
 *  • `data:<tipo>;base64,…` — o tipo é conferido AQUI (é o que o cadastro
 *    manda, e é por onde veio o ataque);
 *  • `http(s)://…` — importação de site/Nuvemshop/Jueri; o conteúdo só é
 *    conhecido na hora de buscar, então quem confere é o servidor ao servir;
 *  • `/caminho/interno` — herança de importações antigas (nunca `//outro`,
 *    que é endereço externo disfarçado de caminho).
 *
 * Tudo o mais é recusado — `javascript:`, `blob:`, `file:` e afins nunca
 * foram foto de peça nenhuma.
 */
export function urlDeFotoAceita(url: string): boolean {
  const u = url.trim();
  if (u.startsWith("data:")) {
    const m = u.match(/^data:([^;,]+)/);
    return tipoDeImagem(m?.[1]) !== null;
  }
  if (/^https?:\/\//i.test(u)) return true;
  // Caminho interno de verdade. `//outro.com` e `/\outro.com` NÃO são
  // caminho: o navegador (e o `new URL`) leem a barra invertida como barra,
  // então `/\evil.com/x.jpg` vira `https://evil.com/x.jpg` — de novo um
  // endereço do atacante saindo com o nosso domínio na frente, que é
  // exatamente o que a RN-026 existe para impedir. Barra invertida não
  // aparece em caminho legítimo, então cai fora inteira.
  return u.startsWith("/") && !u.startsWith("//") && !u.includes("\\");
}

/**
 * Cabeçalhos de uma foto entregue ao navegador.
 *
 * Tipo na lista → sai como imagem. Fora da lista → sai como DOWNLOAD inerte
 * (`application/octet-stream` + anexo), nunca como página. Perder a foto
 * quebrada é barato; entregar uma página do atacante no nosso domínio, não.
 *
 * `nosniff` fecha a outra metade: sem ele o navegador ignora o tipo que a
 * gente declara e adivinha pelo conteúdo — declarar não bastaria.
 *
 * O cinto por cima (`Content-Security-Policy: sandbox`, que deixa o arquivo
 * inerte se alguém abrir o endereço direto) NÃO é posto aqui de propósito:
 * medido no servidor de verdade, o cabeçalho definido em `next.config.ts`
 * VENCE o que a rota põe na resposta — a rota mandava `sandbox` e chegava ao
 * navegador só o `frame-ancestors`. Prometer aqui o que não acontece seria
 * pior que não prometer, então o `sandbox` mora no `next.config.ts`, onde
 * ele de fato vale (guardado logo abaixo, no teste desta regra).
 *
 * É o mesmo padrão que a mídia do WhatsApp e o documento de RH já usam.
 */
export function cabecalhosDaFoto(
  mime: string | null | undefined,
  opts: { cache: string; nome?: string }
): Record<string, string> {
  const tipo = tipoDeImagem(mime);
  const base: Record<string, string> = {
    "Cache-Control": opts.cache,
    "X-Content-Type-Options": "nosniff",
  };
  if (tipo) return { ...base, "Content-Type": tipo };

  const nome = (opts.nome || "arquivo").replace(/[^\w.-]+/g, "-").slice(0, 80);
  return {
    ...base,
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${nome}"`,
  };
}
