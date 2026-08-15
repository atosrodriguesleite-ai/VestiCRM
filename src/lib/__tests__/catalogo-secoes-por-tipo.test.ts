import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agruparPorTipo, sortCategories, TIPO_SEM_DONO } from "../categories";

/**
 * "O SHORT NÃO APARECE NO CATÁLOGO DO CLIENTE."
 *
 * O caso que levou dias para entender (Toque Leve, 07/08/2026). A peça
 * ESTAVA no catálogo — o conferidor provou, cor por cor. O que estava
 * quebrado era a NAVEGAÇÃO.
 *
 * A barra de cima ("Conjuntos de calça | Conjuntos de short | Blusas")
 * juntava as categorias de cada tipo numa lista só. A PÁGINA, porém,
 * continuava na ordem crua das categorias — os tipos ficavam intercalados:
 *
 *     short A → legging → blusa → short B
 *
 * Quem tocava em "Conjuntos de short" caía no short A, rolava, via legging e
 * concluía que o short B não existia. Ele existia, enterrado depois de outros
 * tipos. A barra prometia um agrupamento que a página não cumpria.
 *
 * Agora a página é desenhada na MESMA ordem da barra.
 */

const TIPOS = {
  "bermuda bolso traseiro + top": "Conjuntos de short",
  "bermuda bolso lateral + top": "Conjuntos de short",
  "legging basica + top": "Conjuntos de calça",
  "calca flare + top": "Conjuntos de calça",
};

/** A ordem que a loja salvou — com os tipos intercalados (o caso real). */
const SALVAS = [
  "Bermuda bolso traseiro + Top",
  "Legging básica + Top",
  "Blusas",
  "Bermuda bolso lateral + Top",
  "Calça flare + Top",
];

/** O que o catálogo passou a fazer: achatar os grupos vira a ordem da página. */
const ordemDasSecoes = (cats: string[], tipos: Record<string, string>) => {
  const emOrdem = sortCategories(cats, SALVAS);
  const grupos = agruparPorTipo(emOrdem, tipos);
  return grupos.length ? grupos.flatMap((g) => g.categorias) : emOrdem;
};

describe("as seções da página seguem a barra de tipos", () => {
  it("os dois shorts ficam JUNTOS — era o bug do 'short que não aparece'", () => {
    const ordem = ordemDasSecoes([...SALVAS], TIPOS);
    const a = ordem.indexOf("Bermuda bolso traseiro + Top");
    const b = ordem.indexOf("Bermuda bolso lateral + Top");
    expect(Math.abs(a - b)).toBe(1);
  });

  it("nenhum tipo fica intercalado com outro", () => {
    const ordem = ordemDasSecoes([...SALVAS], TIPOS);
    const tipoDe = (c: string) =>
      TIPOS[c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") as keyof typeof TIPOS] ??
      TIPO_SEM_DONO;
    const sequencia = ordem.map(tipoDe);
    // cada tipo pode aparecer em UM bloco só
    const vistos = new Set<string>();
    let anterior = "";
    for (const t of sequencia) {
      if (t !== anterior) {
        expect(vistos.has(t), `"${t}" apareceu em dois pedaços da página`).toBe(false);
        vistos.add(t);
        anterior = t;
      }
    }
  });

  it("categoria sem guarda-chuva vai para o fim, junto com as outras 'Outros'", () => {
    const ordem = ordemDasSecoes([...SALVAS], TIPOS);
    expect(ordem[ordem.length - 1]).toBe("Blusas");
  });

  it("NENHUMA categoria some no caminho", () => {
    const ordem = ordemDasSecoes([...SALVAS], TIPOS);
    expect([...ordem].sort()).toEqual([...SALVAS].sort());
  });

  it("loja que NÃO usa tipos continua exatamente como era", () => {
    const ordem = ordemDasSecoes([...SALVAS], {});
    expect(ordem).toEqual(SALVAS);
  });
});

describe("o catálogo público desenha as seções nessa ordem", () => {
  const fonte = readFileSync(
    join(process.cwd(), "src/app/catalogo/[slug]/public-catalog.tsx"),
    "utf8"
  );

  it("a lista das seções sai dos GRUPOS, não da ordem crua", () => {
    expect(fonte).toContain("grupos.flatMap((g) => g.categorias)");
  });

  it("a barra e as seções usam a MESMA lista (senão desencontram de novo)", () => {
    // `categories` é o que alimenta seções, chips, vigia de rolagem e sacola
    expect(/const categories = useMemo\(\s*\n\s*\(\) => \(grupos\.length \?/.test(fonte)).toBe(
      true
    );
    expect(/\{categories\.map\(\(cat, i\) => \{/.test(fonte)).toBe(true);
  });
});
