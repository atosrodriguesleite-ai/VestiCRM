/**
 * Gera os dados geográficos do MAPA DE ENVIOS (rodado uma vez, resultado
 * commitado — a tela não depende de serviço externo nenhum).
 *
 * Fontes (abertas):
 *  - contornos dos estados: github.com/giuliano-macedo/geodata-br-states
 *    (geojson/br_states.json)
 *  - coordenadas dos 5.570 municípios: github.com/kelvins/municipios-brasileiros
 *    (json/municipios.json)
 *
 * Uso: node scripts/gerar-mapa-envios.mjs <br_states.json> <municipios.json>
 *
 * Saídas:
 *  - src/lib/envios/mapa-brasil.json   contorno de cada UF como path SVG já
 *    PROJETADO (Mercator, viewBox 0 0 620 620) + centro de cada UF
 *  - src/lib/envios/municipios-xy.json "nome-normalizado|UF" → [x, y] na
 *    MESMA projeção (só usado no servidor, para pôr a bolinha da cidade)
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , arqEstados, arqMunicipios] = process.argv;
if (!arqEstados || !arqMunicipios) {
  console.error("uso: node scripts/gerar-mapa-envios.mjs <br_states.json> <municipios.json>");
  process.exit(1);
}

const VIEW = 620; // viewBox quadrado
const PAD = 8;

// ---- projeção Mercator (a mesma para contorno, centro e municípios) ----
// ATENÇÃO às unidades: x e y precisam estar AMBOS em radianos — misturar
// graus com radianos amassa o país num traço de 10px (já aconteceu)
const mercX = (lng) => (lng * Math.PI) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

const estados = JSON.parse(readFileSync(arqEstados, "utf8"));

// limites do país em coordenadas projetadas
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const f of estados.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys)
    for (const anel of poly)
      for (const [lng, lat] of anel) {
        const x = mercX(lng);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        const y = mercY(lat);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
}
const escala = (VIEW - 2 * PAD) / Math.max(maxX - minX, maxY - minY);
// centraliza o eixo menor
const offX = PAD + ((VIEW - 2 * PAD) - (maxX - minX) * escala) / 2;
const offY = PAD + ((VIEW - 2 * PAD) - (maxY - minY) * escala) / 2;
const projetar = (lng, lat) => [
  offX + (mercX(lng) - minX) * escala,
  offY + (maxY - mercY(lat)) * escala, // y cresce para baixo no SVG
];

// ---- simplificação Douglas-Peucker (em px projetados) ----
function simplificar(pontos, tolerancia) {
  if (pontos.length < 3) return pontos;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const marcar = (ini, fim, manter) => {
    let maior = 0, idx = -1;
    for (let i = ini + 1; i < fim; i++) {
      const d = dist(pontos[i], pontos[ini], pontos[fim]);
      if (d > maior) { maior = d; idx = i; }
    }
    if (maior > tolerancia && idx > 0) {
      manter[idx] = true;
      marcar(ini, idx, manter);
      marcar(idx, fim, manter);
    }
  };
  const manter = new Array(pontos.length).fill(false);
  manter[0] = manter[pontos.length - 1] = true;
  marcar(0, pontos.length - 1, manter);
  return pontos.filter((_, i) => manter[i]);
}

const r1 = (n) => Math.round(n * 10) / 10;

const ufs = {};
for (const f of estados.features) {
  const uf = f.id;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  const partes = [];
  let somaX = 0, somaY = 0, somaPeso = 0;
  for (const poly of polys) {
    // só o anel externo — ilhas minúsculas (< 12 pontos) ficam de fora para
    // o arquivo não inchar com pedrinhas no mar
    const anel = poly[0].map(([lng, lat]) => projetar(lng, lat));
    if (anel.length < 12) continue;
    const simples = simplificar(anel, 0.7);
    if (simples.length < 4) continue;
    partes.push("M" + simples.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L") + "Z");
    for (const [x, y] of simples) { somaX += x; somaY += y; }
    somaPeso += simples.length;
  }
  ufs[uf] = {
    d: partes.join(""),
    centro: [r1(somaX / somaPeso), r1(somaY / somaPeso)],
  };
}

// centro "no olho" para estados com litoral recortado: a média dos pontos do
// contorno cai no mar em alguns; a capital é um centro que nunca engana
const municipios = JSON.parse(readFileSync(arqMunicipios, "utf8").replace(/^﻿/, ""));
const SIGLA = { 11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF" };
for (const m of municipios) {
  if (m.capital === 1) {
    const uf = SIGLA[m.codigo_uf];
    if (ufs[uf]) ufs[uf].centro = projetar(m.longitude, m.latitude).map(r1);
  }
}

const normalizar = (t) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const xy = {};
for (const m of municipios) {
  const uf = SIGLA[m.codigo_uf];
  if (!uf) continue;
  const [x, y] = projetar(m.longitude, m.latitude);
  xy[`${normalizar(m.nome)}|${uf}`] = [r1(x), r1(y)];
}

writeFileSync(
  "src/lib/envios/mapa-brasil.json",
  JSON.stringify({ viewBox: `0 0 ${VIEW} ${VIEW}`, ufs })
);
writeFileSync("src/lib/envios/municipios-xy.json", JSON.stringify(xy));

const kb = (o) => Math.round(JSON.stringify(o).length / 1024);
console.log(`mapa-brasil.json: ${kb({ ufs })} KB · municipios-xy.json: ${kb(xy)} KB`);
