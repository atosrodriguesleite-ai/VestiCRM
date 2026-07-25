import { unzip } from "./unzip";
import type { MedidaTamanho, ModeloCorte, PecaModelo, TipoPano } from "./types";

/**
 * Leitor do .adsx (Audaces Moldes). O arquivo é um ZIP com:
 *   - data.xml  → dados do modelo (nome, grade, peças, medidas) — É O OURO
 *   - file.jpg  → miniatura do molde (vira thumbnail no app)
 *   - file.ads  → desenho binário proprietário (ignorado — fechado)
 *   - index.json→ índice do pacote
 *
 * O data.xml vem em ISO-8859-1 e com estrutura fixa; extraímos por regex
 * dirigida (sem parser XML genérico) porque o formato é estável e conhecido.
 */

const num = (s: string | undefined) => {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Pega o conteúdo de <TAG>valor</TAG> dentro de um trecho. */
const tag = (src: string, name: string) =>
  src.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1]?.trim();

/**
 * "1 X TEC" → TEC · "1 X FOR" → FOR. O Audaces marca o pano na descrição da
 * peça; alguns modelistas usam o sufixo "FOR" no nome — cobrimos os dois.
 */
function detectaPano(desc: string, nomePeca: string): TipoPano {
  const d = `${desc} ${nomePeca}`.toUpperCase();
  return /\bFOR\b|\bFORRO\b/.test(d) ? "FOR" : "TEC";
}

export function parseAdsx(zipBuffer: Buffer): ModeloCorte {
  const entries = unzip(zipBuffer);
  const xmlEntry = entries.find((e) => e.name.toLowerCase().endsWith(".xml"));
  if (!xmlEntry)
    throw new Error(
      "O arquivo não tem o data.xml do Audaces — exporte o modelo de novo pelo Audaces Moldes"
    );
  const jpg = entries.find((e) => /\.(jpe?g|png)$/i.test(e.name));

  const xml = xmlEntry.data.toString("latin1");
  const modelo = parseDataXml(xml);
  if (jpg)
    modelo.thumbnail = `data:image/jpeg;base64,${jpg.data.toString("base64")}`;
  return modelo;
}

/** Parser do data.xml (também aceito solto, sem o zip). */
export function parseDataXml(xml: string): ModeloCorte {
  const nome =
    xml.match(/<MODEL\s+NAME_M="([^"]*)"/)?.[1]?.trim() || "Modelo sem nome";

  // Grade: ordem dos tamanhos vem de SIZES_M (o "(BASE X)" é o tamanho base)
  const tamanhos: string[] = [];
  const sizesM = xml.match(/<SIZES_M>[\s\S]*?<\/SIZES_M>/)?.[0] ?? "";
  for (const m of sizesM.matchAll(/<SIZE_M\s+NAME_SP="([^"]*)"/g)) {
    const t = m[1].trim();
    if (t && !tamanhos.includes(t)) tamanhos.push(t);
  }

  const pecas: PecaModelo[] = [];
  for (const pm of xml.matchAll(/<PATTERN\s+NAME_P="([^"]*)">([\s\S]*?)<\/PATTERN>/g)) {
    const nomePeca = pm[1].trim();
    const corpo = pm[2];
    const desc = tag(corpo, "DESC_P") ?? "";
    const qtd = Math.max(1, Math.round(num(tag(corpo, "QT_MOD"))));

    const medidas: Record<string, MedidaTamanho> = {};
    for (const sm of corpo.matchAll(/<SIZE_P\s+NAME_SP="([^"]*)">([\s\S]*?)<\/SIZE_P>/g)) {
      const tam = sm[1].trim();
      const c = sm[2];
      medidas[tam] = {
        w: num(tag(c, "WIDTH_SP")),
        h: num(tag(c, "HEIGHT_SP")),
        area: num(tag(c, "AREA_SP")),
      };
    }
    if (Object.keys(medidas).length === 0) continue; // peça sem medidas não serve

    pecas.push({
      nome: nomePeca,
      pano: detectaPano(desc, nomePeca),
      qtd,
      desc: desc || undefined,
      tamanhos: medidas,
    });
  }

  if (pecas.length === 0)
    throw new Error("Nenhuma peça encontrada no arquivo — confira a exportação");

  // Se SIZES_M veio vazio, deduz a grade pelas peças
  if (tamanhos.length === 0)
    for (const p of pecas)
      for (const t of Object.keys(p.tamanhos))
        if (!tamanhos.includes(t)) tamanhos.push(t);

  return { nome, origem: "ADSX", tamanhos, pecas };
}
