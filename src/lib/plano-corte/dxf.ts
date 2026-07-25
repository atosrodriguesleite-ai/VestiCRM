import type { Contorno, ModeloCorte, PecaModelo } from "./types";

/**
 * Leitor de DXF (AAMA/ASTM ou "baseado no nível") exportado pelo Audaces.
 * O DXF traz o CONTORNO REAL das peças — com ele o encaixe usa a curva
 * verdadeira em vez da caixa retangular.
 *
 * Estrutura que interessa:
 *   - Seção BLOCKS: cada peça(+tamanho) vira um BLOCK com polilinhas
 *     (POLYLINE/VERTEX ou LWPOLYLINE). O contorno de corte é a polilinha
 *     FECHADA de maior área do bloco (as demais são fio/costura/piques).
 *   - Sem BLOCKS (export "básico"): cada polilinha fechada da seção
 *     ENTITIES vira uma peça.
 *
 * Convenção combinada com o lojista: exportar em CENTÍMETROS. Se vier em
 * outra unidade, o fator `escala` corrige (ex.: mm → 0.1).
 */

type Par = { code: number; value: string };

function* pares(texto: string): Generator<Par> {
  const linhas = texto.split(/\r\n|\r|\n/);
  for (let i = 0; i + 1 < linhas.length; i += 2) {
    const code = parseInt(linhas[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    yield { code, value: linhas[i + 1].trim() };
  }
}

type Poli = { pontos: [number, number][]; fechada: boolean; bloco: string | null };

/** Área pelo método do cadarço (shoelace) — sinal indica orientação. */
export function areaPoligono(p: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function parseDxf(texto: string, escala = 1): ModeloCorte {
  const polis: Poli[] = [];
  let blocoAtual: string | null = null;

  // estado da POLYLINE clássica (VERTEX...SEQEND)
  let emPolyline = false;
  let poliPontos: [number, number][] = [];
  let poliFechada = false;

  // estado da LWPOLYLINE (pontos vêm em pares 10/20 na própria entidade)
  let emLw = false;
  let lwPontos: [number, number][] = [];
  let lwFechada = false;
  let lwX: number | null = null;

  let entidade = "";

  const fechaLw = () => {
    if (emLw && lwPontos.length >= 3)
      polis.push({ pontos: lwPontos, fechada: lwFechada, bloco: blocoAtual });
    emLw = false;
    lwPontos = [];
    lwFechada = false;
    lwX = null;
  };

  for (const { code, value } of pares(texto)) {
    if (code === 0) {
      fechaLw();
      if (value === "SEQEND" && emPolyline) {
        if (poliPontos.length >= 3)
          polis.push({ pontos: poliPontos, fechada: poliFechada, bloco: blocoAtual });
        emPolyline = false;
        poliPontos = [];
      }
      entidade = value;
      if (value === "POLYLINE") {
        emPolyline = true;
        poliPontos = [];
        poliFechada = false;
      } else if (value === "LWPOLYLINE") {
        emLw = true;
      } else if (value === "ENDBLK") {
        blocoAtual = null;
      }
      continue;
    }

    if (entidade === "BLOCK" && code === 2) blocoAtual = value;

    if (emLw) {
      if (code === 70) lwFechada = (parseInt(value, 10) & 1) === 1;
      if (code === 10) lwX = parseFloat(value);
      if (code === 20 && lwX !== null) {
        lwPontos.push([lwX * escala, parseFloat(value) * escala]);
        lwX = null;
      }
    } else if (emPolyline) {
      if (entidade === "POLYLINE" && code === 70)
        poliFechada = (parseInt(value, 10) & 1) === 1;
      if (entidade === "VERTEX") {
        if (code === 10) poliPontos.push([parseFloat(value) * escala, 0]);
        if (code === 20 && poliPontos.length > 0)
          poliPontos[poliPontos.length - 1][1] = parseFloat(value) * escala;
      }
    }
  }
  fechaLw();

  // ---- polilinhas → peças ----
  // Agrupa por bloco; o contorno de corte é a polilinha fechada de maior área.
  const grupos = new Map<string, Poli[]>();
  for (const p of polis) {
    if (p.pontos.length < 3) continue;
    const chave = p.bloco ?? `PECA ${grupos.size + 1}`;
    const arr = grupos.get(chave) ?? [];
    arr.push(p);
    grupos.set(chave, arr);
  }

  const pecas: PecaModelo[] = [];
  const tamanhos: string[] = [];

  for (const [bloco, lista] of grupos) {
    const candidatas = lista.filter((p) => p.fechada).length
      ? lista.filter((p) => p.fechada)
      : lista;
    const contornoBruto = candidatas.reduce((a, b) =>
      areaPoligono(a.pontos) >= areaPoligono(b.pontos) ? a : b
    ).pontos;

    // normaliza a origem no canto inferior-esquerdo da peça
    const xs = contornoBruto.map((p) => p[0]);
    const ys = contornoBruto.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const contorno: Contorno = contornoBruto.map(([x, y]) => [
      Math.round((x - minX) * 100) / 100,
      Math.round((y - minY) * 100) / 100,
    ]);
    const w = Math.max(...xs) - minX;
    const h = Math.max(...ys) - minY;
    const area = areaPoligono(contorno);
    if (w <= 0.5 || h <= 0.5 || area <= 1) continue; // ruído (piques, textos)

    // "FRENTE - M" / "FRENTE_M" / "FRENTE M" → peça FRENTE, tamanho M
    const m = bloco.trim().match(/^(.*?)[\s_\-]+([A-Za-z0-9]{1,6})$/);
    const nomePeca = (m ? m[1] : bloco).trim().toUpperCase() || bloco;
    const tamanho = (m ? m[2] : "ÚNICO").toUpperCase();

    if (!tamanhos.includes(tamanho)) tamanhos.push(tamanho);
    let peca = pecas.find((p) => p.nome === nomePeca);
    if (!peca) {
      peca = {
        nome: nomePeca,
        pano: /\bFOR\b|FORRO/.test(nomePeca) ? "FOR" : "TEC",
        qtd: 1,
        tamanhos: {},
      };
      pecas.push(peca);
    }
    peca.tamanhos[tamanho] = {
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      area: Math.round(area * 100) / 100,
      contorno,
    };
  }

  if (pecas.length === 0)
    throw new Error(
      "Não achei contornos de peça no DXF — na exportação, marque 'Contorno com polylines'"
    );

  return { nome: "Modelo DXF", origem: "DXF", tamanhos, pecas };
}
