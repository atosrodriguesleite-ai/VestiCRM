/**
 * TELEFONE: É BRASILEIRO OU É DE FORA? (RN-096)
 *
 * Relato do dono (26/10/2026, print da Toque Leve): a cliente Rafaela
 * aparecia na Central como "(17) 81408-6755", numa conversa "na fila" que
 * ninguém conseguia responder — o WhatsApp dizia que o número não existe.
 * Não existe mesmo: celular brasileiro tem 9 números depois do DDD e começa
 * com 9. O que chegou do WhatsApp foi `17814086755`, que é **+1 781
 * 408-6755**, um número dos Estados Unidos. O sistema olhava "onze dígitos"
 * e concluía "é brasileiro sem o DDI", colando um 55 na frente: nascia o
 * cadastro `5517814086755`, a resposta da loja ia para um número que não é
 * de ninguém, e a cliente que escrevia do exterior ficava sem resposta.
 *
 * Duas réguas, uma para cada lado:
 *
 *  1. **O número que vem do WhatsApp já tem o DDI** — o identificador de lá
 *     é sempre internacional (`5519988394961`, `17814086755`). Quem o passa
 *     adiante escreve o `+` na frente (`declaraDdi`), e aí não há nada a
 *     adivinhar: os dígitos ficam como vieram.
 *  2. **O número digitado só ganha 55 se tiver CARA de brasileiro**
 *     (`pareceNumeroBrasileiroSemDdi`): DDD que existe e, com onze dígitos,
 *     o 9 na terceira posição; com dez, fixo (2–5) ou o celular antigo sem o
 *     9 (6–9, que o cadastro tolera). Onze dígitos começando por "17 8…"
 *     não são um número brasileiro de jeito nenhum — são um DDI e um número.
 *
 * O que FICA ambíguo, dito: um número de fora com onze dígitos cuja cara é
 * exatamente a de um celular brasileiro (um +1 de área 29x, o +51 9… do
 * Peru, o +34 9… de telefone fixo espanhol) continua lido como brasileiro
 * quando é DIGITADO sem o `+`. Vindo do WhatsApp nunca há dúvida — e é de lá
 * que vem a cliente de fora.
 *
 * ESTE ARQUIVO É PURO (sem banco): a tela do catálogo, a Central e o intake
 * leem a mesma régua.
 */

/** Os DDDs que existem no Brasil (Anatel). */
export const DDDS_DO_BRASIL: ReadonlySet<string> = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/**
 * O texto DECLARA o DDI? "+1 781…" e "+55 11…" dizem de onde o número é —
 * não se adivinha nada por cima disso. É assim que o webhook marca o número
 * do WhatsApp (sempre internacional) e que a cliente de fora escreve o dela
 * no catálogo (o formulário já aceitava o `+`; o servidor é que o ignorava).
 */
export function declaraDdi(raw: string | null | undefined): boolean {
  const t = (raw ?? "").trim();
  // "00" é como o brasileiro disca para fora ("00 1 781…"): também declara
  return t.startsWith("+") || /^00[1-9]/.test(t.replace(/[\s().-]/g, ""));
}

/** Os dígitos de um número que declara o DDI (o "00" de discar para fora cai). */
function digitosDeclarados(texto: string): string {
  const d = texto.replace(/\D/g, "");
  return !texto.trim().startsWith("+") && d.startsWith("00") ? d.slice(2) : d;
}

/**
 * Dez ou onze dígitos SEM o DDI com cara de número brasileiro: DDD que
 * existe e, com onze, o 9 do celular na terceira posição; com dez, fixo
 * (2–5) ou o celular antigo sem o 9 (6–9 — o cadastro tolera e o
 * `phoneMatchVariants` põe o 9).
 */
export function pareceNumeroBrasileiroSemDdi(d: string): boolean {
  if (!/^\d{10,11}$/.test(d)) return false;
  if (!DDDS_DO_BRASIL.has(d.slice(0, 2))) return false;
  const terceiro = d[2];
  return d.length === 11 ? terceiro === "9" : /[2-9]/.test(terceiro);
}

/**
 * O número GUARDADO é brasileiro? Aceita a forma de sempre (55 + DDD + número,
 * 12 ou 13 dígitos) e as formas legadas sem o DDI (10 ou 11 dígitos). Fora
 * disso é número de fora — ou lixo, que `formatPhone` devolve como veio.
 */
export function ehNumeroBrasileiro(raw: string | null | undefined): boolean {
  const d = (raw ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    return pareceNumeroBrasileiroSemDdi(d.slice(2));
  }
  return pareceNumeroBrasileiroSemDdi(d);
}

/**
 * Códigos de país de UM dígito (1 e 7) e de DOIS dígitos (lista fechada da
 * UIT); todos os outros têm três. É o que separa o DDI do resto para mostrar
 * "+1 781 408-6755" em vez de "+178 140-86755".
 */
const DDI_DE_DOIS = new Set([
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58",
  "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91",
  "92", "93", "94", "95", "98",
]);

/** Separa o DDI do número; null quando os dígitos não formam um número. */
export function dividirDdi(d: string): { ddi: string; resto: string } | null {
  if (!/^[1-9]\d{7,14}$/.test(d)) return null;
  const tamanho =
    d[0] === "1" || d[0] === "7" ? 1 : DDI_DE_DOIS.has(d.slice(0, 2)) ? 2 : 3;
  const resto = d.slice(tamanho);
  if (resto.length < 4) return null;
  return { ddi: d.slice(0, tamanho), resto };
}

/**
 * "+1 781 408-6755": DDI, espaço, e o número em grupos de três com os
 * quatro últimos depois do hífen — legível para qualquer país sem a tabela
 * de formatos de cada um.
 */
export function formatarInternacional(d: string): string | null {
  const partes = dividirDdi(d);
  if (!partes) return null;
  const { ddi, resto } = partes;
  if (resto.length <= 4) return `+${ddi} ${resto}`;
  const fim = resto.slice(-4);
  const comeco = resto.slice(0, -4);
  const grupos: string[] = [];
  for (let i = comeco.length; i > 0; i -= 3) grupos.unshift(comeco.slice(Math.max(0, i - 3), i));
  return `+${ddi} ${grupos.join(" ")}-${fim}`;
}

/**
 * Normaliza telefone para o formato de armazenamento: só dígitos, com o DDI
 * (brasileiro = 55 na frente). Número que declara o DDI (`+`/`00`) ou que
 * não tem cara de brasileiro fica como veio (RN-096).
 */
export function normalizePhone(raw: string): string {
  const texto = raw ?? "";
  if (declaraDdi(texto)) return digitosDeclarados(texto);
  let digits = texto.replace(/\D/g, "");
  if (pareceNumeroBrasileiroSemDdi(digits)) digits = "55" + digits;
  return digits;
}

/**
 * O MESMO número escrito de outro jeito (com/sem 9º dígito, com/sem DDI,
 * com/sem o 55 colado por engano)? A conferência é nos DOIS sentidos: olhar
 * só as variantes de um lado deixa passar forma gravada diferente.
 */
export function mesmoNumero(a: string, b: string): boolean {
  return (
    phoneMatchVariants(a).includes(normalizePhone(b)) ||
    phoneMatchVariants(b).includes(normalizePhone(a))
  );
}

/**
 * Variações do MESMO número para dedup. Brasileiro: tolera o "9º dígito"
 * (um celular pode aparecer com 9 — 55 DD 9XXXXXXXX — ou sem; o WhatsApp
 * costuma mandar com 9, cadastros antigos ficam sem) e as formas legadas sem
 * o DDI. De fora: a forma certa e a que o sistema gravava ANTES da RN-096
 * (com um 55 colado na frente), para o cadastro antigo da cliente de fora
 * ser achado — e curado — em vez de virar um segundo.
 */
export function phoneMatchVariants(raw: string): string[] {
  const d = normalizePhone(raw);
  const set = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const sub = d.slice(4); // parte após DDI+DDD
    const subs = new Set<string>([sub]);
    if (sub.length === 9 && sub.startsWith("9")) subs.add(sub.slice(1)); // tira o 9
    if (sub.length === 8) subs.add(`9${sub}`); // põe o 9
    for (const s of subs) {
      set.add(`55${ddd}${s}`);
      set.add(`${ddd}${s}`); // cadastros legados salvos SEM o DDI 55
    }
  } else if (
    (d.length === 10 || d.length === 11) &&
    (declaraDdi(raw) || !ehNumeroBrasileiro(d))
  ) {
    // o 55 colado por engano antes da RN-096 — também para o número de fora
    // com a cara de um brasileiro (+51 9… do Peru), quando o DDI veio dito:
    // o cadastro antigo dele tem que ser achado, não duplicado
    set.add(`55${d}`);
  }
  return [...set];
}

/**
 * O cadastro guardou um número de fora com o 55 colado por engano (antes da
 * RN-096)? Vale só quando o número de agora é o MESMO sem o 55 e o sistema
 * SABE que ele não é brasileiro: pela cara dele, ou porque o número é
 * VERIFICADO — veio do próprio WhatsApp, que sempre manda o DDI (o "+1 29x…"
 * com cara de celular do DDD 12, o "+51 9…" do Peru). O "+" digitado por
 * gente num formulário NÃO basta: "+11 99876-1001" é um brasileiro com o DDI
 * esquecido, e a cura tiraria o 55 de um cadastro certo. É a cura de carona
 * do intake.
 */
export function guardadoComCinquentaECincoPorEngano(
  guardado: string,
  agora: string,
  verificadoPeloWhatsApp = false
): boolean {
  if (guardado !== `55${agora}`) return false;
  if (verificadoPeloWhatsApp) return true;
  return !ehNumeroBrasileiro(agora) && !ehNumeroBrasileiro(guardado);
}
