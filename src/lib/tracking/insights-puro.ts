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

/**
 * Identidade para AGRUPAR: além do invisível (chaveDoNome), ignora CAIXA e
 * ACENTO — na Toque Leve a mesma cor vivia como "cafe" e "Café" e o quadro
 * de Cores mostrava duas linhas (print do dono, 21/09/2026). Grafia que
 * difere só nisso é a mesma coisa para o ranking e para a curva ABC; cores
 * DIFERENTES de verdade ("Preto" × "Preta") continuam duas linhas.
 */
export const chaveDeGrupo = (s: string) =>
  chaveDoNome(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Entre duas grafias do MESMO grupo, qual EXIBIR: a mais caprichada — com
 * acento vence sem acento, inicial maiúscula vence minúscula. Sem isso o
 * rótulo dependia da ordem em que as vendas chegavam do banco, e a linha
 * juntada podia sair "cafe" num dia e "Café" no outro.
 */
export const melhorRotulo = (atual: string, novo: string) => {
  const pontos = (s: string) =>
    (s === s.normalize("NFD").replace(/[̀-ͯ]/g, "") ? 0 : 2) +
    (/^\p{Lu}/u.test(s) ? 1 : 0);
  return pontos(novo) > pontos(atual) ? novo : atual;
};
