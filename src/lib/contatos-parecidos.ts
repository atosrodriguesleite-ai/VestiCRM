import { normalizePhone } from "./intake";

/**
 * CONTATO PARECIDO — "é a mesma pessoa cadastrada duas vezes?"
 *
 * Incidente real (Toque Leve, 20/08/2026): a mesma cliente existia em DOIS
 * cadastros — "Patricia Amorim" com (75) 9128-9574 e "Patricia Amorim dos
 * Santos" com (75) 99128-9575. Como cada cadastro tem a sua conversa, a
 * Nívia e a Letícia atendiam a mesma pessoa em telas diferentes, cada uma
 * vendo metade do assunto. Pior: um dos números estava ERRADO (dígito
 * trocado na digitação), então o que a Letícia escrevia saía do sistema e
 * não chegava em ninguém — ficava no ✓ simples para sempre.
 *
 * O dedup do Lead Intake (RN-008) já resolve o "9º dígito", que é o caso
 * comum. O que ele NÃO pega — nem tem como — é DÍGITO DIGITADO ERRADO: para
 * o sistema, 91289574 e 91289575 são dois números diferentes, e adivinhar
 * seria pior (juntaria duas clientes de verdade).
 *
 * Então aqui não se adivinha: só se AVISA. A regra é de propósito
 * conservadora e exige as DUAS coisas ao mesmo tempo:
 *
 *   1. nome parecido (igual, ou um é o começo do outro — "Patricia Amorim"
 *      dentro de "Patricia Amorim dos Santos"); E
 *   2. telefone quase igual (mesmo DDD e no máximo UM dígito de diferença,
 *      já ignorando o 9º dígito).
 *
 * Exigir as duas é o que impede o falso alarme óbvio: duas "Maria Silva" de
 * verdade têm números completamente diferentes, e duas irmãs com números
 * seguidos têm nomes diferentes.
 */

export type ContatoBasico = {
  id: string;
  name: string;
  phone: string;
};

/** Sem acento, sem caixa, sem espaço dobrado — para comparar nome de gente. */
export function normNome(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O número "de comparar": só os dígitos do assinante (sem DDI), com o 9º
 * dígito removido, mais o DDD à parte. É assim que 91289574 e 991289575
 * ficam comparáveis (91289574 × 91289575 → um dígito de diferença).
 */
export function partesDoTelefone(raw: string): { ddd: string; numero: string } | null {
  const d = normalizePhone(raw);
  if (!d.startsWith("55") || d.length < 12) return null;
  const ddd = d.slice(2, 4);
  let numero = d.slice(4);
  if (numero.length === 9 && numero.startsWith("9")) numero = numero.slice(1);
  return { ddd, numero };
}

/** Distância de edição com teto 1: dá para trocar/tirar/pôr UM dígito? */
export function distanciaAte1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let erros = 0;
  while (i < curto.length && j < longo.length) {
    if (curto[i] === longo[j]) {
      i++;
      j++;
      continue;
    }
    if (++erros > 1) return false;
    if (curto.length === longo.length) i++; // troca
    j++; // sobra um dígito no longo
  }
  return erros + (longo.length - j) <= 1;
}

/** Nomes que provavelmente são da mesma pessoa. */
export function nomeParecido(a: string, b: string): boolean {
  const x = normNome(a);
  const y = normNome(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // um é o começo do outro, cortando em PALAVRA inteira ("Ana" não casa com
  // "Anabela", mas "Ana Paula" casa com "Ana Paula dos Santos")
  const [curto, longo] = x.length <= y.length ? [x, y] : [y, x];
  return longo.startsWith(`${curto} `) && curto.includes(" ");
}

/** Telefones que provavelmente são da mesma pessoa (um dígito de diferença). */
export function telefoneParecido(a: string, b: string): boolean {
  const pa = partesDoTelefone(a);
  const pb = partesDoTelefone(b);
  if (!pa || !pb) return false;
  if (pa.ddd !== pb.ddd) return false;
  return distanciaAte1(pa.numero, pb.numero);
}

/**
 * O contato é PARECIDO com o outro? Exige nome parecido E telefone quase
 * igual — na dúvida, NÃO avisa: alarme falso em cadastro de cliente faz a
 * loja parar de ler o aviso.
 */
export function ehContatoParecido(a: ContatoBasico, b: ContatoBasico): boolean {
  if (a.id === b.id) return false;
  return nomeParecido(a.name, b.name) && telefoneParecido(a.phone, b.phone);
}

/** Todos os parecidos de um contato dentro de uma lista de candidatos. */
export function acharParecidos(
  alvo: ContatoBasico,
  candidatos: ContatoBasico[]
): ContatoBasico[] {
  return candidatos.filter((c) => ehContatoParecido(alvo, c));
}
