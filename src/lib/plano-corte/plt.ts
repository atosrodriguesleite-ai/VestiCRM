import type { Risco } from "./types";

/**
 * Gerador de PLT (HPGL) — o arquivo que a plotter de risco imprime em
 * escala real 1:1. HPGL trabalha em unidades de 0,025mm → 400 por cm.
 * Comandos usados: IN (inicia), SP (caneta), PU (caneta erguida),
 * PD (caneta no papel), LB (texto), DT (terminador do texto), SI (fonte).
 */

const U = 400; // unidades HPGL por cm

const pt = (xCm: number, yCm: number) => `${Math.round(xCm * U)},${Math.round(yCm * U)}`;

/**
 * Converte um risco no arquivo PLT. O risco é desenhado "deitado": o
 * comprimento corre no eixo X da plotter (sentido do papel) e a largura
 * do tecido no eixo Y — igual sai do Audaces.
 */
export function riscoParaPlt(risco: Risco, tituloModelo: string): string {
  const cmd: string[] = ["IN;", "SP1;"];

  // moldura do risco (ajuda a conferir esquadro e escala na mesa)
  cmd.push(
    `PU${pt(0, 0)};`,
    `PD${pt(risco.comprimentoCm, 0)},${pt(risco.comprimentoCm, risco.larguraCm)},${pt(0, risco.larguraCm)},${pt(0, 0)};`
  );

  for (const p of risco.pecas) {
    // O encaixe guarda x na largura e y no comprimento; no papel o
    // comprimento corre no eixo X. A conversão é ROTAÇÃO verdadeira de
    // 90° — (x, y) → (y, L − x) — nunca troca de eixos, que espelharia a
    // peça (fio/costura errados na mesa de corte).
    const X = (my: number) => my;
    const Y = (mx: number) => risco.larguraCm - mx;
    if (p.contorno && p.contorno.length >= 3) {
      const pts = p.contorno.map(([cx, cy]) => {
        const rx = p.rot === 180 ? p.w - cx : cx;
        const ry = p.rot === 180 ? p.h - cy : cy;
        return [X(p.y + ry), Y(p.x + rx)] as [number, number];
      });
      cmd.push(`PU${pt(pts[0][0], pts[0][1])};`);
      cmd.push(`PD${pts.slice(1).map(([x, y]) => pt(x, y)).join(",")},${pt(pts[0][0], pts[0][1])};`);
    } else {
      cmd.push(
        `PU${pt(X(p.y), Y(p.x))};`,
        `PD${pt(X(p.y + p.h), Y(p.x))},${pt(X(p.y + p.h), Y(p.x + p.w))},${pt(X(p.y), Y(p.x + p.w))},${pt(X(p.y), Y(p.x))};`
      );
    }
    // rótulo dentro da peça: NOME TAM
    cmd.push(
      "DT~;",
      `PU${pt(X(p.y + p.h / 2) - Math.min(4, p.h / 3), Y(p.x + p.w / 2))};`,
      "SI0.35,0.5;",
      `LB${p.nome} ${p.tamanho}${p.espelhada ? " INV" : ""}~;`
    );
  }

  // identificação do risco na borda
  const combo =
    risco.rotulo ??
    Object.entries(risco.combo)
      .map(([t, v]) => (v > 1 ? `${v}X${t}` : t))
      .join("+");
  cmd.push(
    "DT~;",
    `PU${pt(1, risco.larguraCm + 1)};`,
    "SI0.5,0.7;",
    `LB${tituloModelo} | ${combo} | ${(risco.comprimentoCm / 100).toFixed(2)}m x ${(risco.larguraCm / 100).toFixed(2)}m | ${risco.folhas} FOLHAS~;`
  );

  cmd.push(`PU${pt(0, 0)};`, "SP0;");
  return cmd.join("\n") + "\n";
}
