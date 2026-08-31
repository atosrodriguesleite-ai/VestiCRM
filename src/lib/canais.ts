import { originLabel } from "./format";

/**
 * RN-026 · WhatsApp e catálogo público são O MESMO canal nas métricas.
 *
 * A origem gravada no cadastro (`Customer.origin`) separa WHATSAPP de
 * CATALOGO_PUBLICO — mas essa fronteira é um acaso técnico, não um canal de
 * verdade: a mesma cliente que chama no WhatsApp recebe o link do catálogo e
 * pede por ele. Quem entra "pelo catálogo" entrou pelo atendimento da loja do
 * mesmo jeito (decisão do dono, 31/08/2026). Separar os dois nos gráficos
 * fazia o canal das vendedoras parecer dois canais pequenos ao lado da
 * Nuvemshop — e a loja tirava conclusão errada de onde investir.
 *
 * Este arquivo é o ÚNICO lugar que sabe dessa soma: toda tela que agrega
 * métrica por canal (Marketing, Relatórios, exportação CSV) passa por aqui.
 * O `Customer.origin` continua gravado separado no banco — a régua é só de
 * APRESENTAÇÃO, e desfazer a soma é trocar uma função, não migrar dados.
 */

/** Chave do canal unido (vale também como valor do filtro `?canal=`). */
export const CANAL_WHATSAPP_CATALOGO = "WHATSAPP_CATALOGO";

const ORIGENS_UNIDAS = ["WHATSAPP", "CATALOGO_PUBLICO"];

/** De qual canal (de métrica) é um cliente com esta origem. */
export function canalDaOrigem(origin: string): string {
  return ORIGENS_UNIDAS.includes(origin) ? CANAL_WHATSAPP_CATALOGO : origin;
}

/**
 * Quais origens do banco compõem um canal — é o que o filtro por canal usa
 * para montar o `where` (o canal unido filtra as duas origens de uma vez).
 */
export function origensDoCanal(canal: string): string[] {
  return canal === CANAL_WHATSAPP_CATALOGO ? [...ORIGENS_UNIDAS] : [canal];
}

/**
 * Um valor de `?canal=` só vale se for um canal que existe.
 * `Object.hasOwn` (e não `in`): a URL é da visita — `?canal=constructor`
 * passaria pelo `in` via protótipo e derrubaria a tela no Prisma.
 */
export function canalValido(canal: string): boolean {
  return canal === CANAL_WHATSAPP_CATALOGO || Object.hasOwn(originLabel, canal);
}

/**
 * Nome do canal na tela. Aceita também a origem crua e canoniza sozinho:
 * `labelDoCanal("WHATSAPP")` já devolve o nome do canal unido — esquecer o
 * `canalDaOrigem` no meio não pode ressuscitar o canal separado.
 */
export function labelDoCanal(canal: string): string {
  const c = canalDaOrigem(canal);
  if (c === CANAL_WHATSAPP_CATALOGO) return "WhatsApp e catálogo";
  return Object.hasOwn(originLabel, c) ? originLabel[c as keyof typeof originLabel] : c;
}
