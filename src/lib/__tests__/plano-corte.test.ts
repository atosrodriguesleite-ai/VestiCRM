import { describe, expect, it } from "vitest";
import { unzip } from "../plano-corte/unzip";
import { parseAdsx, parseDataXml } from "../plano-corte/audaces";
import { parseDxf, areaPoligono } from "../plano-corte/dxf";
import { encaixarMelhor } from "../plano-corte/nesting";
import { montarPlano } from "../plano-corte/enfesto";
import { riscoParaPlt } from "../plano-corte/plt";
import { riscoParaSvg } from "../plano-corte/svg";
import type { ParametrosPlano } from "../plano-corte/types";

/* ---------- fixtures ---------- */

/** Monta um ZIP "stored" (sem compressão) na mão — igual o .adsx aceita. */
function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8); // método 0 = stored
    local.writeUInt32LE(f.data.length, 18); // comp size
    local.writeUInt32LE(f.data.length, 22); // uncomp size
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, f.data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt32LE(f.data.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += 30 + name.length + f.data.length;
  }
  const cenStart = offset;
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(cenStart, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}

const XML_MINI = `<?xml version="1.0" encoding="iso-8859-1"?>
<DATA_FILE_AUDACES ID="1" VER="3">
 <MODEL NAME_M="REGATA TESTE">
  <INFO><SIZES_M>
   <SIZE_M NAME_SP="P"><PER_SM>1</PER_SM><AREA_SM>1</AREA_SM></SIZE_M>
   <SIZE_M NAME_SP="M"><PER_SM>1</PER_SM><AREA_SM>1</AREA_SM></SIZE_M>
  </SIZES_M></INFO>
  <PATTERNS>
   <PATTERN NAME_P="FRENTE">
    <DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD>
    <SIZES_P NAME_GRAD="(P) | M">
     <SIZE_P NAME_SP="P"><PER_SP>10</PER_SP><AREA_SP>1500</AREA_SP><WIDTH_SP>50</WIDTH_SP><HEIGHT_SP>40</HEIGHT_SP></SIZE_P>
     <SIZE_P NAME_SP="M"><PER_SP>10</PER_SP><AREA_SP>1700</AREA_SP><WIDTH_SP>54</WIDTH_SP><HEIGHT_SP>42</HEIGHT_SP></SIZE_P>
    </SIZES_P>
   </PATTERN>
   <PATTERN NAME_P="FRENTE FOR">
    <DESC_P>1 X FOR</DESC_P><QT_MOD>2</QT_MOD>
    <SIZES_P NAME_GRAD="(P) | M">
     <SIZE_P NAME_SP="P"><PER_SP>8</PER_SP><AREA_SP>700</AREA_SP><WIDTH_SP>30</WIDTH_SP><HEIGHT_SP>28</HEIGHT_SP></SIZE_P>
     <SIZE_P NAME_SP="M"><PER_SP>8</PER_SP><AREA_SP>800</AREA_SP><WIDTH_SP>32</WIDTH_SP><HEIGHT_SP>30</HEIGHT_SP></SIZE_P>
    </SIZES_P>
   </PATTERN>
  </PATTERNS>
 </MODEL>
</DATA_FILE_AUDACES>`;

const paramsBase: ParametrosPlano = {
  grade: { P: 10, M: 10 },
  larguraTecidoCm: 160,
  mesaCm: 600,
  folgaCm: 1,
  maxFolhas: 60,
  perdaPorFolhaCm: 3,
  incluirForro: true,
  pecasDesligadas: [],
};

/* ---------- unzip + parser Audaces ---------- */

describe("leitor .adsx (Audaces)", () => {
  it("abre o zip e lê modelo, grade, peças e pano (TEC/FOR)", () => {
    const zip = zipStored([
      { name: "data.xml", data: Buffer.from(XML_MINI, "latin1") },
    ]);
    const modelo = parseAdsx(zip);
    expect(modelo.nome).toBe("REGATA TESTE");
    expect(modelo.tamanhos).toEqual(["P", "M"]);
    expect(modelo.pecas).toHaveLength(2);
    expect(modelo.pecas[0]).toMatchObject({ nome: "FRENTE", pano: "TEC", qtd: 1 });
    expect(modelo.pecas[1]).toMatchObject({ nome: "FRENTE FOR", pano: "FOR", qtd: 2 });
    expect(modelo.pecas[0].tamanhos.P).toMatchObject({ w: 50, h: 40, area: 1500 });
  });

  it("unzip lê entrada stored com nome e conteúdo", () => {
    const zip = zipStored([{ name: "a.txt", data: Buffer.from("ola") }]);
    const entries = unzip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("a.txt");
    expect(entries[0].data.toString()).toBe("ola");
  });

  it("recusa arquivo sem data.xml", () => {
    const zip = zipStored([{ name: "x.bin", data: Buffer.from("nada") }]);
    expect(() => parseAdsx(zip)).toThrow(/data\.xml/);
  });

  it("parseDataXml aceita o xml solto", () => {
    const modelo = parseDataXml(XML_MINI);
    expect(modelo.pecas).toHaveLength(2);
  });
});

/* ---------- parser DXF ---------- */

describe("leitor DXF", () => {
  it("extrai contorno de LWPOLYLINE em bloco, com nome e tamanho", () => {
    const dxf = [
      "0", "SECTION", "2", "BLOCKS",
      "0", "BLOCK", "2", "FRENTE - M",
      "0", "LWPOLYLINE", "90", "4", "70", "1",
      "10", "0", "20", "0",
      "10", "40", "20", "0",
      "10", "40", "20", "30",
      "10", "0", "20", "30",
      "0", "ENDBLK",
      "0", "ENDSEC", "0", "EOF",
    ].join("\n");
    const modelo = parseDxf(dxf);
    expect(modelo.pecas).toHaveLength(1);
    expect(modelo.pecas[0].nome).toBe("FRENTE");
    expect(modelo.tamanhos).toEqual(["M"]);
    const med = modelo.pecas[0].tamanhos.M;
    expect(med.w).toBe(40);
    expect(med.h).toBe(30);
    expect(med.area).toBe(1200);
    expect(med.contorno).toHaveLength(4);
  });

  it("área do polígono (cadarço)", () => {
    expect(areaPoligono([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
  });
});

/* ---------- motor de encaixe ---------- */

describe("motor de encaixe", () => {
  it("peças não se sobrepõem e respeitam a largura", () => {
    const pecas = Array.from({ length: 12 }, (_, i) => ({
      nome: `P${i}`,
      tamanho: "U",
      w: 30 + (i % 4) * 10,
      h: 25 + (i % 3) * 12,
      area: 600,
    }));
    const r = encaixarMelhor(pecas, 160, 0);
    expect(r.pecas).toHaveLength(12);
    for (const p of r.pecas) {
      expect(p.x + p.w).toBeLessThanOrEqual(160.001);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
    // sem sobreposição par a par
    for (let i = 0; i < r.pecas.length; i++)
      for (let j = i + 1; j < r.pecas.length; j++) {
        const a = r.pecas[i];
        const b = r.pecas[j];
        const separa =
          a.x + a.w <= b.x + 0.001 ||
          b.x + b.w <= a.x + 0.001 ||
          a.y + a.h <= b.y + 0.001 ||
          b.y + b.h <= a.y + 0.001;
        expect(separa).toBe(true);
      }
    expect(r.comprimentoCm).toBeGreaterThan(0);
  });

  it("usa a concavidade do contorno (triângulos encaixam melhor que caixas)", () => {
    // dois triângulos retos: encaixados formam quase um retângulo
    const tri = (nome: string) => ({
      nome,
      tamanho: "U",
      w: 40,
      h: 40,
      area: 800,
      contorno: [[0, 0], [40, 0], [0, 40]] as [number, number][],
    });
    const r = encaixarMelhor([tri("A"), tri("B")], 50, 0);
    // com rotação 180° o segundo mergulha na diagonal: bem menos que 80 de altura
    expect(r.comprimentoCm).toBeLessThan(70);
  });

  it("recusa peça mais larga que o tecido", () => {
    expect(() =>
      encaixarMelhor([{ nome: "X", tamanho: "U", w: 200, h: 10, area: 100 }], 160, 0)
    ).toThrow(/larga/);
  });
});

/* ---------- planejador de enfesto ---------- */

describe("planejador de enfesto", () => {
  const modelo = parseDataXml(XML_MINI);

  it("fecha a grade exata (sem sobras) em todos os panos", () => {
    const r = montarPlano(modelo, { ...paramsBase, grade: { P: 30, M: 50 } });
    expect(r.planos.map((p) => p.pano).sort()).toEqual(["FOR", "TEC"]);
    for (const plano of r.planos) {
      // cada tamanho: Σ folhas × proporção no risco = quantidade pedida
      const porTamanho: Record<string, number> = {};
      for (const risco of plano.riscos)
        for (const [t, v] of Object.entries(risco.combo))
          porTamanho[t] = (porTamanho[t] ?? 0) + risco.folhas * v;
      expect(porTamanho).toEqual({ P: 30, M: 50 });
    }
  });

  it("forro tem risco separado e respeita QT_MOD (2 peças por roupa)", () => {
    const r = montarPlano(modelo, { ...paramsBase, grade: { P: 2 } });
    const forro = r.planos.find((p) => p.pano === "FOR")!;
    // 2 roupas × QT_MOD 2 = 4 peças de forro no total (folhas × peças do risco)
    const totalPecas = forro.riscos.reduce((s, ri) => s + ri.folhas * ri.pecas.length, 0);
    expect(totalPecas).toBe(4);
  });

  it("desligar o forro remove o plano do forro", () => {
    const r = montarPlano(modelo, { ...paramsBase, incluirForro: false });
    expect(r.planos.map((p) => p.pano)).toEqual(["TEC"]);
  });

  it("desligar uma peça tira ela dos riscos", () => {
    const r = montarPlano(modelo, { ...paramsBase, pecasDesligadas: ["FRENTE FOR"] });
    expect(r.planos.map((p) => p.pano)).toEqual(["TEC"]);
  });

  it("respeita a mesa: nenhum risco maior que ela", () => {
    const r = montarPlano(modelo, { ...paramsBase, grade: { P: 40, M: 40 }, mesaCm: 150 });
    for (const plano of r.planos)
      for (const risco of plano.riscos)
        expect(risco.comprimentoCm).toBeLessThanOrEqual(150.001);
  });

  it("normaliza nome de tamanho com espaço extra", () => {
    const r = montarPlano(modelo, { ...paramsBase, grade: { "P ": 4, M: 0 } });
    expect(r.totalPecasRoupa).toBe(4);
    const tec = r.planos.find((p) => p.pano === "TEC")!;
    const totalPecas = tec.riscos.reduce((s, ri) => s + ri.folhas * ri.pecas.length, 0);
    expect(totalPecas).toBe(4); // 4 roupas × 1 FRENTE
  });

  it("tamanho inexistente vira erro claro", () => {
    expect(() => montarPlano(modelo, { ...paramsBase, grade: { GG: 5 } })).toThrow(/GG/);
  });

  it("REGRA DO FIO: peça entra girada — fio (eixo X do CAD) corre no comprimento", () => {
    // FRENTE P no CAD: 50 (fio) × 40 → no risco: 40 na largura, 50 no comprimento
    const r = montarPlano(modelo, { ...paramsBase, grade: { P: 1 }, pecasDesligadas: ["FRENTE FOR"] });
    const risco = r.planos[0].riscos[0];
    expect(risco.pecas).toHaveLength(1);
    expect(risco.pecas[0].w).toBe(40); // atravessa a largura do tecido
    expect(risco.pecas[0].h).toBe(50); // fio, no comprimento do rolo
    expect(risco.comprimentoCm).toBe(50);
  });

  it("tecido com sentido (sentidoUnico) nunca gira peça 180°", () => {
    const r = montarPlano(modelo, { ...paramsBase, sentidoUnico: true });
    for (const plano of r.planos)
      for (const risco of plano.riscos) {
        expect(risco.estrategiaEncaixe).not.toContain("rotação");
        for (const p of risco.pecas) expect(p.rot).toBe(0);
      }
  });

  it("compara estratégias e escolhe a mais econômica", () => {
    const r = montarPlano(modelo, { ...paramsBase, grade: { P: 30, M: 50 } });
    for (const plano of r.planos) {
      expect(plano.comparativo.length).toBeGreaterThan(1);
      const menor = Math.min(...plano.comparativo.map((c) => c.totalTecidoCm));
      expect(plano.totalTecidoCm).toBe(menor);
    }
  });
});

/* ---------- saídas (SVG + PLT) ---------- */

describe("saídas do plano", () => {
  const modelo = parseDataXml(XML_MINI);
  const r = montarPlano(modelo, paramsBase);
  const risco = r.planos[0].riscos[0];

  it("SVG desenha todas as peças com rótulo", () => {
    const svg = riscoParaSvg(risco);
    expect(svg).toContain("<svg");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(risco.pecas.length);
    expect(svg).toContain("FRENTE");
  });

  it("PLT sai em escala real (400 unidades por cm) com comandos HPGL", () => {
    const plt = riscoParaPlt(risco, "TESTE");
    expect(plt.startsWith("IN;\nSP1;")).toBe(true);
    expect(plt).toContain("PD");
    expect(plt).toContain("LB");
    // moldura: largura do risco em unidades = larguraCm × 400
    expect(plt).toContain(`${Math.round(risco.larguraCm * 400)}`);
    expect(plt.trim().endsWith("SP0;")).toBe(true);
  });
});

/* ---------- quantidade por peça (peça em PAR) ---------- */

describe("quantas vezes a peça é cortada por roupa", () => {
  const modeloCom = (patterns: string) =>
    parseDataXml(`<?xml version="1.0" encoding="iso-8859-1"?>
<DATA_FILE_AUDACES><MODEL NAME_M="T"><INFO><SIZES_M>
 <SIZE_M NAME_SP="P"></SIZE_M></SIZES_M></INFO>
<PATTERNS>${patterns}</PATTERNS></MODEL></DATA_FILE_AUDACES>`);

  const peca = (nome: string, campos: string) => `
   <PATTERN NAME_P="${nome}">${campos}
    <SIZES_P><SIZE_P NAME_SP="P"><AREA_SP>500</AREA_SP><WIDTH_SP>20</WIDTH_SP><HEIGHT_SP>25</HEIGHT_SP></SIZE_P></SIZES_P>
   </PATTERN>`;

  it("peça simples (DOUBLE=2) sai 1 vez", () => {
    const m = modeloCom(peca("FRENTE", "<DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>"));
    expect(m.pecas[0].qtd).toBe(1);
  });

  it("PEÇA ESPELHADA (DOUBLE=1) sai 2 vezes — manga, alça, bolso", () => {
    const m = modeloCom(peca("MANGA", "<DESC_P></DESC_P><QT_MOD>1</QT_MOD><DOUBLE>1</DOUBLE>"));
    expect(m.pecas[0].qtd).toBe(2);
  });

  it("descrição '2 X TEC' do modelista vale", () => {
    const m = modeloCom(peca("ALCA", "<DESC_P>2 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>"));
    expect(m.pecas[0].qtd).toBe(2);
  });

  it("'PAR' no nome da peça também conta", () => {
    const m = modeloCom(peca("MANGA 1PAR TEC", "<DESC_P></DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>"));
    expect(m.pecas[0].qtd).toBe(2);
  });

  it("QT_MOD alto manda quando é o maior", () => {
    const m = modeloCom(peca("BABADO", "<DESC_P>1 X TEC</DESC_P><QT_MOD>4</QT_MOD><DOUBLE>2</DOUBLE>"));
    expect(m.pecas[0].qtd).toBe(4);
  });

  it("nunca menos de 1, mesmo com o arquivo sem os campos", () => {
    const m = modeloCom(peca("X", "<DESC_P></DESC_P>"));
    expect(m.pecas[0].qtd).toBe(1);
  });

  it("a peça em par entra 2× no risco (o plano corta as duas)", () => {
    const m = modeloCom(
      peca("FRENTE", "<DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD><DOUBLE>2</DOUBLE>") +
        peca("MANGA", "<DESC_P></DESC_P><QT_MOD>1</QT_MOD><DOUBLE>1</DOUBLE>")
    );
    const r = montarPlano(m, { ...paramsBase, grade: { P: 1 }, incluirForro: false });
    const risco = r.planos[0].riscos[0];
    expect(risco.pecas.filter((p) => p.nome === "FRENTE")).toHaveLength(1);
    expect(risco.pecas.filter((p) => p.nome === "MANGA")).toHaveLength(2);
  });
});
