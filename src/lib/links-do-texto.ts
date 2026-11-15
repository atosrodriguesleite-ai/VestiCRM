/**
 * LINKS NO TEXTO DA CONVERSA — o que vira link clicável na bolha.
 *
 * Pedido do dono (15/11/2026): "abrir links enviados e recebidos nas
 * conversas". A bolha desenhava o texto cru: o link do catálogo, do rastreio
 * ou do Instagram da cliente era só letra — a vendedora tinha de copiar a
 * mensagem, abrir o navegador e colar.
 *
 * Três réguas, todas de segurança ou de bom senso:
 *
 * 1. SÓ `http` e `https`. O texto vem da CLIENTE: nada do que ela escrever
 *    vira `javascript:`, `data:` ou outro esquema — o endereço é montado por
 *    nós e conferido pelo leitor de endereços do próprio navegador. Endereço
 *    com usuário embutido ("banco.com@outro.com", o truque de quem quer que
 *    um domínio pareça outro) NÃO vira link.
 *
 * 2. O QUE APARECE É O QUE FOI ESCRITO. O link não ganha texto novo: a
 *    pessoa lê o endereço inteiro antes de tocar.
 *
 * 3. DOMÍNIO SOLTO (sem "https://") só vira link quando tem cara de endereço:
 *    tudo em minúsculas e com terminação conhecida. "certo.Com certeza" e
 *    "obrigada.Me avisa" (ponto sem espaço, a letra maiúscula do corretor)
 *    não são endereços; e a terminação que também é PALAVRA ou sílaba ("me",
 *    "ar", "site", "link", "online"…) só vale com caminho depois —
 *    "wa.me/5511…" e "bit.ly/abc" são links; "fala.me" e "manda o site.link
 *    do catálogo" não. Sem caminho, só ".com", ".net", ".org" e ".br".
 *    LIMITE DITO: "amanha.com certeza", em minúsculas e sem acento, vira
 *    link (como no próprio WhatsApp) — não há como separar de "loja.com".
 *
 * 4. O ENDEREÇO NÃO PERDE PEDAÇO. Da ponta só sai a pontuação da FRASE
 *    (ponto, vírgula, parêntese que fecha a frase). O "_" do fim é do
 *    endereço — "instagram.com/toqueleve_" é OUTRO perfil sem ele (achado da
 *    revisão) —, e o "*", "_" ou "~" só saem quando são a marcação de
 *    negrito/itálico do WhatsApp, isto é, quando o MESMO sinal abre o link.
 *
 * 5. A LEITURA É LINEAR. A mensagem do WhatsApp pode ter 65 mil letras
 *    coladas; a busca tem teto de rótulos e de tamanho por rótulo, senão uma
 *    mensagem dessas travava a Central de quem abrisse a conversa (medido na
 *    revisão: 3 segundos).
 */

export type ParteDoTexto =
  | { tipo: "texto"; texto: string }
  | { tipo: "link"; texto: string; href: string };

/** terminações que valem mesmo sem caminho: "loja.com.br", "catalago.net" */
const FORTES = ["com", "net", "org", "br"];
/**
 * Terminações que só valem com caminho ("wa.me/…", "bit.ly/…",
 * "minhaloja.app/x"): as curtas e as que também são palavra do dia a dia.
 */
const SO_COM_CAMINHO = [
  "me", "ly", "co", "io", "tv", "gg", "to", "cc", "ar", "pt", "us",
  "app", "shop", "store", "site", "online", "link", "page", "dev", "info", "blog", "tech", "digital",
];

// rótulo de até 63 letras (o teto de um domínio de verdade) e no máximo 6
// rótulos antes da terminação: sem esses tetos a busca volta atrás letra a
// letra numa sequência comprida e o tempo cresce ao quadrado
const ROTULO = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const RESTO = "[^\\s<>\"]";
const ACHAR = new RegExp(
  [
    // 1) com esquema: https://… ou http://…
    `(https?:\\/\\/${RESTO}+)`,
    // 2) www.…
    `(www\\.${RESTO}+)`,
    // 3) domínio solto: rótulos + terminação conhecida (+ caminho opcional)
    `((?:${ROTULO}\\.){1,6}(?:${[...FORTES, ...SO_COM_CAMINHO].join("|")})(?![a-z0-9-])(?:[/?#]${RESTO}*)?)`,
  ].join("|"),
  "gi"
);

/** pontuação que fecha a FRASE, não o endereço: "veja em loja.com.br." */
const SOBRA = new Set([".", ",", ";", ":", "!", "?", "…", "'", '"', "”", "’", ")", "]", "}", ">"]);
/** marcação do WhatsApp (negrito, itálico, riscado) em volta do link */
const MARCACAO = new Set(["*", "_", "~"]);

/**
 * Tira da ponta o que é da frase. `antes` é a letra que vem logo ANTES do
 * achado: o "*", "_" ou "~" do fim só sai quando o mesmo sinal abre o link.
 */
function apararSobra(bruto: string, antes: string): string {
  let fim = bruto.length;
  while (fim > 0) {
    const ultima = bruto[fim - 1];
    if (MARCACAO.has(ultima)) {
      if (ultima !== antes) break;
      fim--;
      // um par só: "*https://x.com/a_*" devolve "https://x.com/a_"
      antes = "";
      continue;
    }
    if (!SOBRA.has(ultima)) break;
    // o ")" que FECHA um "(" de dentro do endereço é do endereço
    if (ultima === ")") {
      const corpo = bruto.slice(0, fim);
      const abre = corpo.split("(").length - 1;
      const fecha = corpo.split(")").length - 1;
      if (fecha <= abre) break;
    }
    fim--;
  }
  return bruto.slice(0, fim);
}

/** Monta o endereço e confere: só http(s), com domínio de verdade, sem usuário. */
function enderecoSeguro(texto: string, comEsquema: boolean): string | null {
  const candidato = comEsquema ? texto : `https://${texto}`;
  let u: URL;
  try {
    u = new URL(candidato);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes(".")) return null;
  return u.href;
}

/** O domínio solto vale? (minúsculas; terminação curta só com caminho) */
function dominioSoltoVale(texto: string): boolean {
  const m = /^([^/?#]+)([/?#].*)?$/.exec(texto);
  if (!m) return false;
  const host = m[1];
  if (host !== host.toLowerCase()) return false;
  const terminacao = host.slice(host.lastIndexOf(".") + 1);
  if (SO_COM_CAMINHO.includes(terminacao)) return Boolean(m[2] && m[2].length > 1);
  return true;
}

/**
 * Quebra o texto em pedaços de texto e de link, na ordem. Juntando os
 * `texto` de todos os pedaços volta-se EXATAMENTE ao texto original.
 */
export function partesDoTexto(texto: string): ParteDoTexto[] {
  const partes: ParteDoTexto[] = [];
  let cursor = 0;
  const empurrarTexto = (ate: number) => {
    if (ate > cursor) partes.push({ tipo: "texto", texto: texto.slice(cursor, ate) });
  };
  ACHAR.lastIndex = 0;
  for (let m = ACHAR.exec(texto); m; m = ACHAR.exec(texto)) {
    const comEsquema = m[1] !== undefined;
    const solto = m[3] !== undefined;
    const inicio = m.index;
    const antes = inicio > 0 ? texto[inicio - 1] : "";
    const depois = texto[inicio + m[0].length] ?? "";
    // colado numa palavra, num e-mail ou num caminho: não é começo de endereço
    // (letra com acento conta: em "peça.net" o achado começa no "a")
    // — salvo o sinal de negrito/itálico do WhatsApp abrindo a palavra:
    // "_www.loja.com.br_"
    const abreMarcacao =
      MARCACAO.has(antes) && (inicio < 2 || /\s/.test(texto[inicio - 2]));
    if (!comEsquema && !abreMarcacao && /[\p{L}\p{N}@._\-/]/u.test(antes)) continue;
    // e não é FIM de endereço se logo depois vem "@" (é o nome de um e-mail:
    // "minhaloja.com@gmail.com") ou letra ("loja.comércio" — a terminação
    // "com" só encostou no "é")
    if (!comEsquema && /[\p{L}\p{N}@]/u.test(depois)) continue;
    const limpo = apararSobra(m[0], antes);
    if (!limpo) continue;
    if (solto && !dominioSoltoVale(limpo)) continue;
    // "www." sozinho, ou "https://" sem nada depois
    const href = enderecoSeguro(limpo, comEsquema);
    if (!href) continue;
    empurrarTexto(inicio);
    partes.push({ tipo: "link", texto: limpo, href });
    cursor = inicio + limpo.length;
    // a sobra aparada volta para o texto: o próximo achado começa depois dela
    ACHAR.lastIndex = cursor;
  }
  empurrarTexto(texto.length);
  return partes;
}

/** O texto tem algum link? (para não montar nada quando não tem) */
export function temLink(texto: string): boolean {
  return partesDoTexto(texto).some((p) => p.tipo === "link");
}

/**
 * As páginas PÚBLICAS do próprio sistema (as que não têm o menu do app): é
 * só para elas que a janela com X existe. Lista fechada, de propósito — o
 * que está sob `/api/` REDIRECIONA para fora (o encurtador da bio, a mídia
 * gravada como link) e não pode entrar numa janela que diz "sistema".
 */
const PAGINAS_PUBLICAS = [
  "/catalogo/",
  "/c/",
  "/bio/",
  "/dados/",
  "/rastreio/",
  "/declaracao/",
  "/pagamento/",
  "/ficha/",
];

/**
 * ONDE O LINK ABRE.
 *
 * Endereço de FORA abre fora: aba nova no navegador; no aplicativo
 * instalado, o próprio aparelho abre o navegador por cima, com o botão de
 * voltar para o app.
 *
 * Página PÚBLICA do próprio sistema (rastreio, dados de envio, catálogo sem
 * domínio próprio) dentro do aplicativo INSTALADO é a armadilha do PDF
 * (`lib/documento-no-chat.ts`): o aparelho abre DENTRO do app, sem aba e sem
 * botão de voltar, e a pessoa só sai fechando o aplicativo. Essa abre numa
 * janela nossa por cima da conversa, com X. Qualquer outro endereço do
 * sistema (uma tela do app, que tem o menu; um caminho de `/api/`) segue o
 * link normal.
 */
export function ondeAbrir(
  href: string,
  origemDoApp: string,
  instalado: boolean
): "fora" | "janela" {
  if (!instalado) return "fora";
  try {
    const u = new URL(href);
    if (u.origin !== origemDoApp) return "fora";
    return PAGINAS_PUBLICAS.some((p) => u.pathname.startsWith(p)) ? "janela" : "fora";
  } catch {
    return "fora";
  }
}
