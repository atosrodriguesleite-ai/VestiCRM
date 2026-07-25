import { describe, expect, it } from "vitest";
import { parseDataXml } from "../plano-corte/audaces";
import { montarPlanoMulti, type ItemPedido } from "../plano-corte/enfesto";
import { rodarRodada, type EstadoOtimizacao } from "../plano-corte/otimizador";
import type { ParametrosPlano, ResultadoPlano } from "../plano-corte/types";

/* ---------- fixtures ---------- */

const XML_A = `<?xml version="1.0" encoding="iso-8859-1"?>
<DATA_FILE_AUDACES><MODEL NAME_M="BLUSA A"><INFO><SIZES_M>
 <SIZE_M NAME_SP="P"></SIZE_M><SIZE_M NAME_SP="M"></SIZE_M>
</SIZES_M></INFO><PATTERNS>
 <PATTERN NAME_P="FRENTE"><DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD>
  <SIZES_P><SIZE_P NAME_SP="P"><AREA_SP>1400</AREA_SP><WIDTH_SP>48</WIDTH_SP><HEIGHT_SP>38</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>1600</AREA_SP><WIDTH_SP>52</WIDTH_SP><HEIGHT_SP>40</HEIGHT_SP></SIZE_P></SIZES_P>
 </PATTERN>
 <PATTERN NAME_P="COSTAS"><DESC_P>1 X TEC</DESC_P><QT_MOD>1</QT_MOD>
  <SIZES_P><SIZE_P NAME_SP="P"><AREA_SP>1450</AREA_SP><WIDTH_SP>49</WIDTH_SP><HEIGHT_SP>38</HEIGHT_SP></SIZE_P>
   <SIZE_P NAME_SP="M"><AREA_SP>1650</AREA_SP><WIDTH_SP>53</WIDTH_SP><HEIGHT_SP>40</HEIGHT_SP></SIZE_P></SIZES_P>
 </PATTERN>
</PATTERNS></MODEL></DATA_FILE_AUDACES>`;

const XML_B = XML_A.replace("BLUSA A", "REGATA B")
  .replace(/WIDTH_SP>48/g, "WIDTH_SP>30")
  .replace(/WIDTH_SP>52/g, "WIDTH_SP>33")
  .replace(/WIDTH_SP>49/g, "WIDTH_SP>31")
  .replace(/WIDTH_SP>53/g, "WIDTH_SP>34");

const params: ParametrosPlano = {
  grade: {},
  larguraTecidoCm: 160,
  mesaCm: 600,
  folgaCm: 0.5,
  maxFolhas: 60,
  perdaPorFolhaCm: 3,
  incluirForro: true,
  pecasDesligadas: [],
};

const fechamento = (resultado: ResultadoPlano, pano: string) => {
  const porChave: Record<string, number> = {};
  for (const p of resultado.planos.filter((pl) => pl.pano === pano))
    for (const r of p.riscos)
      for (const [t, v] of Object.entries(r.combo))
        porChave[t] = (porChave[t] ?? 0) + r.folhas * v;
  return porChave;
};

/* ---------- multi-modelo ---------- */

describe("plano multi-modelo (grade composta)", () => {
  const itens: ItemPedido[] = [
    { modelo: parseDataXml(XML_A), grade: { P: 6, M: 10 } },
    { modelo: parseDataXml(XML_B), grade: { P: 4, M: 10 } },
  ];

  it("fecha a grade dos DOIS modelos sem sobras", () => {
    const r = montarPlanoMulti(itens, params);
    expect(r.totalPecasRoupa).toBe(30);
    expect(fechamento(r, "TEC")).toEqual({ "0|P": 6, "0|M": 10, "1|P": 4, "1|M": 10 });
  });

  it("peças carregam o nome do modelo e o risco tem rótulo legível", () => {
    const r = montarPlanoMulti(itens, params);
    const risco = r.planos[0].riscos[0];
    expect(risco.rotulo).toBeTruthy();
    expect(risco.rotulo).toMatch(/BLUSA A|REGATA B/);
    expect(risco.pecas.some((p) => p.nome.includes("·"))).toBe(true);
  });

  it("peças desligadas POR MODELO não entram", () => {
    const r = montarPlanoMulti(
      [{ ...itens[0], pecasDesligadas: ["COSTAS"] }, itens[1]],
      params
    );
    for (const plano of r.planos)
      for (const risco of plano.riscos)
        expect(
          risco.pecas.some((p) => p.nome === "COSTAS · BLUSA A")
        ).toBe(false);
  });

  it("com 1 modelo as chaves seguem simples (compatibilidade)", () => {
    const r = montarPlanoMulti([itens[0]], params);
    expect(fechamento(r, "TEC")).toEqual({ P: 6, M: 10 });
  });
});

/* ---------- otimizador em rodadas ---------- */

describe("otimizador em rodadas", () => {
  const itens: ItemPedido[] = [{ modelo: parseDataXml(XML_A), grade: { P: 8, M: 12 } }];

  it("BASE devolve plano na 1ª rodada; rodadas seguintes nunca pioram", () => {
    let estado: EstadoOtimizacao | null = null;
    let resultado: ResultadoPlano | null = null;
    const totais: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = rodarRodada(itens, params, estado, resultado, 30_000, 700);
      estado = r.estado;
      resultado = r.resultado;
      totais.push(resultado.planos[0].totalTecidoCm);
      if (estado.fase === "DONE") break;
    }
    expect(resultado).not.toBeNull();
    // monotônico: cada rodada só mantém ou melhora
    for (let i = 1; i < totais.length; i++)
      expect(totais[i]).toBeLessThanOrEqual(totais[i - 1] + 0.001);
    // a grade continua fechada depois de todas as mutações
    expect(fechamento(resultado!, "TEC")).toEqual({ P: 8, M: 12 });
  });

  it("orçamento esgotado encerra com DONE", () => {
    let estado: EstadoOtimizacao | null = null;
    let resultado: ResultadoPlano | null = null;
    for (let i = 0; i < 30 && (!estado || estado.fase !== "DONE"); i++) {
      const r = rodarRodada(itens, params, estado, resultado, 2_000, 600);
      estado = r.estado;
      resultado = r.resultado;
    }
    expect(estado!.fase).toBe("DONE");
    expect(estado!.tentativas).toBeGreaterThan(0);
    expect(estado!.elapsedMs).toBeGreaterThan(0);
  });

  it("mesma semente → rodadas determinísticas (retomada confiável)", () => {
    const roda = () => {
      let estado: EstadoOtimizacao | null = null;
      let resultado: ResultadoPlano | null = null;
      for (let i = 0; i < 3; i++) {
        const r = rodarRodada(itens, params, estado, resultado, 30_000, 400);
        estado = r.estado;
        resultado = r.resultado;
      }
      return resultado!.planos[0].totalTecidoCm;
    };
    // tempo influencia quantas mutações cabem, então comparamos com folga:
    // as duas execuções devem ficar coladas (mesma trilha de decisões)
    const a = roda();
    const b = roda();
    expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(a, b) * 0.03);
  });

  it("sentido único atravessa o otimizador (nenhuma peça de cabeça pra baixo)", () => {
    let estado: EstadoOtimizacao | null = null;
    let resultado: ResultadoPlano | null = null;
    const p2 = { ...params, sentidoUnico: true };
    for (let i = 0; i < 4; i++) {
      const r = rodarRodada(itens, p2, estado, resultado, 3_000, 500);
      estado = r.estado;
      resultado = r.resultado;
      if (estado.fase === "DONE") break;
    }
    for (const plano of resultado!.planos)
      for (const risco of plano.riscos)
        for (const peca of risco.pecas) expect(peca.rot).toBe(0);
  });
});
