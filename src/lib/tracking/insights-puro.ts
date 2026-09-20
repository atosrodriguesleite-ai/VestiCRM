/**
 * Nomes "iguais" que diferem no invisível — espaço sobrando no fim, acento
 * gravado de outro jeito (ç composto × ç decomposto), caixa diferente —
 * viravam LINHAS DUPLICADAS no ranking: "Regata Alça" aparecia duas vezes na
 * tela Inteligência (relato do dono, 22/08/2026). A identidade da linha é o
 * nome normalizado; o texto EXIBIDO é a primeira forma vista. Mora num
 * arquivo sem banco para a curva ABC (pura) e a tela poderem importar.
 */
export const chaveDoNome = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** Arredondamento a duas casas e porcentagem — UMA régua para todo o tracking. */
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);
