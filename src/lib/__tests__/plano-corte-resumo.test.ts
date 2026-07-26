import { describe, expect, it } from "vitest";
import { parseDataXml } from "../plano-corte/audaces";
import { montarPlano, montarPlanoMulti } from "../plano-corte/enfesto";
import { resumoDeCorte } from "../plano-corte/resumo";
import type { ParametrosPlano } from "../plano-corte/types";

/**
 * Resumo de corte: a contagem de peças que a cortadeira confere na mesa.
 * Exemplo do lojista: 2 mangas + 1 gola + frente + costas = 5 itens.
 */

const paramsBase: ParametrosPlano = {
  grade: { P: 1 },
  larguraTecidoCm: 160,
  mesaCm: 600,
  folgaCm: 0.5,
  maxFolhas: 50,
  perdaPorFolhaCm: 3,
  incluirForro: false,
  pecasDesligadas: [],
};

/** Blusa de 5 itens por roupa: frente, costas, gola e 2 mangas (par). */
const XML_BLUSA = `<?xml version="1.0" encoding="iso-8859-1"?>
<DATA_FILE_AUDACES><MODEL NAME_M="BLUSA"><INFO><SIZES_M>
 <SIZE_M NAME_SP="P"></SIZE_M><SIZE_M NAME_SP="M"></SIZE_M></SIZES_M></INFO><PATTERNS>
 <PATTERN NAME_P="FRENTE"><DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>
  <SIZES_P>
   <SIZE_P NAME_SP="P"><AREA_SP>2000</AREA_SP><WIDTH_SP>45</WIDTH_SP><HEIGHT_SP>60</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>2200</AREA_SP><WIDTH_SP>48</WIDTH_SP><HEIGHT_SP>62</HEIGHT_SP></SIZE_P>
  </SIZES_P></PATTERN>
 <PATTERN NAME_P="COSTAS"><DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>
  <SIZES_P>
   <SIZE_P NAME_SP="P"><AREA_SP>2000</AREA_SP><WIDTH_SP>45</WIDTH_SP><HEIGHT_SP>60</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>2200</AREA_SP><WIDTH_SP>48</WIDTH_SP><HEIGHT_SP>62</HEIGHT_SP></SIZE_P>
  </SIZES_P></PATTERN>
 <PATTERN NAME_P="GOLA"><DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>
  <SIZES_P>
   <SIZE_P NAME_SP="P"><AREA_SP>150</AREA_SP><WIDTH_SP>50</WIDTH_SP><HEIGHT_SP>4</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>160</AREA_SP><WIDTH_SP>52</WIDTH_SP><HEIGHT_SP>4</HEIGHT_SP></SIZE_P>
  </SIZES_P></PATTERN>
 <PATTERN NAME_P="MANGA"><DESC_P></DESC_P><QT_MOD>1</QT_MOD><DOUBLE>1</DOUBLE>
  <SIZES_P>
   <SIZE_P NAME_SP="P"><AREA_SP>600</AREA_SP><WIDTH_SP>30</WIDTH_SP><HEIGHT_SP>25</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>650</AREA_SP><WIDTH_SP>32</WIDTH_SP><HEIGHT_SP>26</HEIGHT_SP></SIZE_P>
  </SIZES_P></PATTERN>
</PATTERNS></MODEL></DATA_FILE_AUDACES>`;

const blusa = parseDataXml(XML_BLUSA);

describe("resumo de corte", () => {
  it("uma roupa: 2 mangas + gola + frente + costas = 5 itens", () => {
    const r = montarPlano(blusa, { ...paramsBase, grade: { P: 1 } });
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.totalRoupas).toBe(1);
    expect(resumo.pecasPorRoupa).toBe(5);
    expect(resumo.totalPecas).toBe(5);
    const manga = resumo.porPeca.find((p) => p.nome === "MANGA")!;
    expect(manga).toMatchObject({ porRoupa: 2, total: 2 });
    expect(resumo.porPeca.find((p) => p.nome === "GOLA")!.total).toBe(1);
  });

  it("10 roupas de cada tamanho: 20 roupas × 5 = 100 peças", () => {
    const r = montarPlano(blusa, { ...paramsBase, grade: { P: 10, M: 10 } });
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.totalRoupas).toBe(20);
    expect(resumo.totalPecas).toBe(100);
    expect(resumo.porPeca.find((p) => p.nome === "MANGA")!.total).toBe(40);
    expect(resumo.porPeca.find((p) => p.nome === "FRENTE")!.total).toBe(20);
  });

  it("quebra por tamanho: roupas e peças de cada um", () => {
    const r = montarPlano(blusa, { ...paramsBase, grade: { P: 6, M: 4 } });
    const resumo = resumoDeCorte(r.planos);
    const porTam = Object.fromEntries(resumo.porTamanho.map((t) => [t.tamanho, t]));
    expect(porTam.P).toMatchObject({ roupas: 6, pecas: 30 });
    expect(porTam.M).toMatchObject({ roupas: 4, pecas: 20 });
  });

  it("a lista vem da peça que mais sai pra que menos sai", () => {
    const r = montarPlano(blusa, { ...paramsBase, grade: { P: 5 } });
    const totais = resumoDeCorte(r.planos).porPeca.map((p) => p.total);
    expect(totais).toEqual([...totais].sort((a, b) => b - a));
  });

  it("peça desligada não entra na conta", () => {
    const r = montarPlano(blusa, {
      ...paramsBase,
      grade: { P: 3 },
      pecasDesligadas: ["GOLA"],
    });
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.porPeca.find((p) => p.nome === "GOLA")).toBeUndefined();
    expect(resumo.totalPecas).toBe(12); // 3 roupas × 4 itens
    expect(resumo.pecasPorRoupa).toBe(4);
  });

  // bug real (Toque Leve): o galão de acabamento vinha gradeado só no
  // tamanho base e SUMIA dos outros tamanhos — o corte saía com peça a menos
  it("peça gradeada num tamanho só entra em TODOS os tamanhos", () => {
    const soNoP = parseDataXml(
      XML_BLUSA.replace(
        '<SIZE_P NAME_SP="M"><AREA_SP>160</AREA_SP><WIDTH_SP>52</WIDTH_SP><HEIGHT_SP>4</HEIGHT_SP></SIZE_P>',
        ""
      )
    );
    expect(Object.keys(soNoP.pecas.find((p) => p.nome === "GOLA")!.tamanhos)).toEqual([
      "P",
    ]);
    const r = montarPlano(soNoP, { ...paramsBase, grade: { P: 10, M: 10 } });
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.porPeca.find((p) => p.nome === "GOLA")!.total).toBe(20);
    expect(resumo.totalPecas).toBe(100); // 20 roupas × 5 itens, nada sumiu
    expect(resumo.pecasPorRoupa).toBe(5);
    expect(r.planos[0].avisos.join(" ")).toContain("GOLA");
  });

  it("plano com 2 modelos separa a contagem de cada um", () => {
    const r = montarPlanoMulti(
      [
        { modelo: blusa, grade: { P: 4 } },
        { modelo: { ...blusa, nome: "REGATA" }, grade: { M: 6 } },
      ],
      { ...paramsBase, grade: {} }
    );
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.totalRoupas).toBe(10);
    expect(resumo.totalPecas).toBe(50);
    const mangaBlusa = resumo.porPeca.find(
      (p) => p.nome === "MANGA" && p.modelo === "BLUSA"
    )!;
    const mangaRegata = resumo.porPeca.find(
      (p) => p.nome === "MANGA" && p.modelo === "REGATA"
    )!;
    expect(mangaBlusa).toMatchObject({ porRoupa: 2, total: 8 });
    expect(mangaRegata).toMatchObject({ porRoupa: 2, total: 12 });
  });

  it("forro em risco separado entra na pilha, sem inflar as roupas", () => {
    const comForro = parseDataXml(
      XML_BLUSA.replace(
        '<PATTERN NAME_P="GOLA"><DESC_P>1 X TEC</DESC_P>',
        '<PATTERN NAME_P="GOLA FOR"><DESC_P>1 X FOR</DESC_P>'
      )
    );
    const r = montarPlano(comForro, {
      ...paramsBase,
      grade: { P: 5 },
      incluirForro: true,
    });
    const resumo = resumoDeCorte(r.planos);
    expect(resumo.totalRoupas).toBe(5); // não conta a grade duas vezes
    expect(resumo.totalPecas).toBe(25); // 4 no tecido + 1 no forro, × 5
    expect(resumo.porPeca.find((p) => p.nome === "GOLA FOR")).toMatchObject({
      pano: "FOR",
      total: 5,
    });
  });
});
