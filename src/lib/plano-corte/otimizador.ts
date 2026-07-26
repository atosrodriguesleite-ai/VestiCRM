import { empacotarOrdem, type PecaEncaixe } from "./nesting";
import {
  montarPlanoMulti,
  pecasDoRiscoMulti,
  rotuloDoCombo,
  type ItemPedido,
} from "./enfesto";
import type { ParametrosPlano, PlanoPano, ResultadoPlano, Risco } from "./types";

/**
 * Otimizador em RODADAS — o "pensar demorado" do plano de corte.
 *
 * O servidor não pode calcular por 10 minutos direto, então a otimização
 * roda em rodadas de alguns segundos: cada rodada retoma o estado salvo,
 * melhora o que der e devolve o estado atualizado. A tela chama rodada
 * atrás de rodada até o orçamento de tempo acabar — mostrando barra de
 * progresso, cronômetro e o plano melhorando ao vivo.
 *
 * Fases:
 *   BASE     → o planejador clássico (estratégias de enfesto + funil de
 *              encaixe) monta o primeiro plano completo
 *   MELHORIA → busca local: embaralha e MUTA a sequência de peças de cada
 *              risco (troca pares, inverte trechos, move peça) milhares de
 *              vezes; melhorou, adota — igual encaixador experiente
 *              "cutucando" o risco pra ganhar centímetros
 *   FINO     → lupa fina: reempacota os riscos finais com resolução dobrada
 *              (0,25cm) pra raspar os últimos milímetros
 *   DONE     → orçamento esgotado ou convergiu (nada melhora há muito tempo)
 */

export type EstadoOtimizacao = {
  fase: "BASE" | "POLIR" | "MELHORIA" | "FINO" | "DONE";
  seed: number; // semente do gerador — rodadas são determinísticas
  tentativas: number; // encaixes completos avaliados até agora
  elapsedMs: number; // tempo de cálculo acumulado (todas as rodadas)
  semMelhora: number; // mutações seguidas sem ganho (critério de convergência)
  ciclos: number; // quantas voltas MELHORIA→FINO já fechou
  ganhouNoCiclo: boolean; // alguma melhoria nesta volta? (pra convergência)
};

export function estadoInicial(): EstadoOtimizacao {
  return {
    fase: "BASE",
    seed: 123456789,
    tentativas: 0,
    elapsedMs: 0,
    semMelhora: 0,
    ciclos: 0,
    ganhouNoCiclo: false,
  };
}

/** Gerador determinístico (mulberry32) — retomável entre rodadas. */
function criaRng(seed: number) {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    get seed() {
      return s;
    },
  };
}

/** Reconstrói as instâncias de peça de um risco a partir dos posicionamentos. */
function sequenciaDoRisco(risco: Risco): PecaEncaixe[] {
  return risco.pecas.map((p) => ({
    nome: p.nome,
    tamanho: p.tamanho,
    w: p.w,
    h: p.h,
    area: p.w * p.h, // aproximação só pra ordenar; aproveitamento é recalculado à parte
    espelhada: p.espelhada,
    modeloIdx: p.modeloIdx,
    contorno: p.contorno,
  }));
}

/** Recalcula totais e aproveitamentos do plano após riscos mudarem. */
function recalcularPlano(
  plano: PlanoPano,
  itens: ItemPedido[],
  params: ParametrosPlano
) {
  let total = 0;
  let areaPecasTotal = 0;
  let areaTecidoTotal = 0;
  for (const risco of plano.riscos) {
    const areaPecas = pecasDoRiscoMulti(itens, plano.pano, risco.combo, params).reduce(
      (s, p) => s + p.area,
      0
    );
    const areaRisco = risco.larguraCm * risco.comprimentoCm;
    risco.aproveitamento =
      areaRisco > 0 ? Math.round((areaPecas / areaRisco) * 1000) / 10 : 0;
    total += risco.folhas * (risco.comprimentoCm + params.perdaPorFolhaCm);
    areaPecasTotal += risco.folhas * areaPecas;
    areaTecidoTotal += risco.folhas * areaRisco;
  }
  plano.totalTecidoCm = Math.round(total);
  plano.areaPecasCm2 = Math.round(areaPecasTotal);
  plano.aproveitamentoMedio =
    areaTecidoTotal > 0
      ? Math.round((areaPecasTotal / areaTecidoTotal) * 1000) / 10
      : 0;
  // O comparativo guarda o total da estratégia vencedora na época da BASE;
  // atualiza a linha dela pro número novo (as outras ficam como referência).
  // O nome ganha sufixos no caminho ("+ remanejo entre cortes"), então a
  // busca é pelo nome-base — senão a linha vencedora ficava congelada no
  // número antigo e a tela mostrava metragem maior que a do topo.
  const base = plano.estrategiaEnfesto.split(" + ")[0];
  const linha = plano.comparativo.find((c) => c.estrategia === base);
  if (linha && plano.totalTecidoCm < linha.totalTecidoCm)
    linha.totalTecidoCm = plano.totalTecidoCm;
}

/** Uma mutação de sequência: troca, inversão de trecho ou mudança de posição. */
function mutar(
  seq: PecaEncaixe[],
  rng: ReturnType<typeof criaRng>
): PecaEncaixe[] {
  const n = seq.length;
  const out = [...seq];
  const tipo = rng.next();
  const i = Math.floor(rng.next() * n);
  const j = Math.floor(rng.next() * n);
  if (n < 2 || i === j) return out;
  if (tipo < 0.45) {
    // troca simples
    [out[i], out[j]] = [out[j], out[i]];
  } else if (tipo < 0.75) {
    // inverte o trecho entre i e j
    const [a, b] = i < j ? [i, j] : [j, i];
    for (let k = 0; k < (b - a + 1) / 2; k++)
      [out[a + k], out[b - k]] = [out[b - k], out[a + k]];
  } else {
    // tira de i e enfia em j
    const [peca] = out.splice(i, 1);
    out.splice(j, 0, peca);
  }
  return out;
}

export type ProgressoRodada = {
  estado: EstadoOtimizacao;
  resultado: ResultadoPlano;
};

/**
 * Executa UMA rodada de otimização (~budgetRoundMs de cálculo) e devolve
 * estado + melhor resultado. Chamar de novo com o estado devolvido continua
 * exatamente de onde parou.
 */
export function rodarRodada(
  itens: ItemPedido[],
  params: ParametrosPlano,
  estadoAnterior: EstadoOtimizacao | null,
  resultadoAnterior: ResultadoPlano | null,
  budgetTotalMs: number,
  budgetRoundMs = 8500
): ProgressoRodada {
  const inicio = Date.now();
  const estado = estadoAnterior ? { ...estadoAnterior } : estadoInicial();
  const acabou = () => Date.now() - inicio >= budgetRoundMs;

  // ---- fase BASE: o planejador clássico monta o primeiro plano ----
  // (leve, sem polimento — pra tela já mostrar um plano em segundos)
  let resultado = resultadoAnterior;
  if (estado.fase === "BASE" || !resultado) {
    resultado = montarPlanoMulti(itens, params, false);
    estado.tentativas += resultado.analises;
    estado.fase = "POLIR";
    estado.elapsedMs += Date.now() - inicio;
    estado.seed = (estado.seed + 0x9e3779b9) >>> 0;
    if (estado.elapsedMs >= budgetTotalMs) estado.fase = "DONE";
    return { estado, resultado }; // devolve já: a tela mostra o 1º plano
  }

  // ---- fase POLIR: o planejador completo (multiplicações + motor caro) ----
  // Uma rodada dedicada e pesada; adota pano a pano só o que melhorar.
  if (estado.fase === "POLIR") {
    const completo = montarPlanoMulti(itens, params, true);
    estado.tentativas += completo.analises;
    for (const planoNovo of completo.planos) {
      const idx = resultado.planos.findIndex((p) => p.pano === planoNovo.pano);
      if (idx < 0) continue;
      if (planoNovo.totalTecidoCm < resultado.planos[idx].totalTecidoCm)
        resultado.planos[idx] = planoNovo;
    }
    estado.fase = "MELHORIA";
    estado.elapsedMs += Date.now() - inicio;
    estado.seed = (estado.seed + 0x9e3779b9) >>> 0;
    if (estado.elapsedMs >= budgetTotalMs) estado.fase = "DONE";
    return { estado, resultado };
  }

  const rng = criaRng(estado.seed);
  const permitir180 = !params.sentidoUnico;

  // riscos elegíveis pra melhoria, ordenados por impacto (folhas × tamanho):
  // ganhar 3cm num risco de 50 folhas vale 1,5m — ele merece mais atenção
  const alvos = resultado.planos
    .flatMap((plano) => plano.riscos.map((risco) => ({ plano, risco })))
    .filter((a) => a.risco.pecas.length >= 2)
    .sort(
      (a, b) =>
        b.risco.folhas * b.risco.comprimentoCm - a.risco.folhas * a.risco.comprimentoCm
    );

  /**
   * MUTAÇÃO ENTRE CORTES: tenta mover UMA roupa de um corte pra outro do
   * mesmo pano com as MESMAS folhas (a produção não muda!) e re-encaixa os
   * dois. É assim que o sistema descobre que "a P do modelo 3 rende mais
   * no vão da GG do modelo 1" — a conta que não cabe na cabeça de ninguém.
   * Corte que esvaziar é eliminado (menos enfesto pra equipe).
   */
  const tentarMoverEntreCortes = (): boolean => {
    // agrupa cortes por pano+folhas (só entre iguais a troca é neutra)
    const grupos = new Map<string, { plano: PlanoPano; riscos: Risco[] }>();
    for (const plano of resultado!.planos)
      for (const risco of plano.riscos) {
        const k = `${plano.pano}|${risco.folhas}`;
        const g = grupos.get(k) ?? { plano, riscos: [] };
        g.riscos.push(risco);
        grupos.set(k, g);
      }
    const elegiveis = [...grupos.values()].filter((g) => g.riscos.length >= 2);
    if (elegiveis.length === 0) return false;
    const g = elegiveis[Math.floor(rng.next() * elegiveis.length)];
    const a = g.riscos[Math.floor(rng.next() * g.riscos.length)];
    let b = g.riscos[Math.floor(rng.next() * g.riscos.length)];
    if (a === b) b = g.riscos[(g.riscos.indexOf(a) + 1) % g.riscos.length];
    const chaves = Object.keys(a.combo);
    if (chaves.length === 0) return false;
    const chave = chaves[Math.floor(rng.next() * chaves.length)];

    // combos candidatos: 1 roupa sai de A e entra em B
    const comboA: Record<string, number> = { ...a.combo, [chave]: a.combo[chave] - 1 };
    if (comboA[chave] <= 0) delete comboA[chave];
    const comboB: Record<string, number> = { ...b.combo, [chave]: (b.combo[chave] ?? 0) + 1 };

    estado.tentativas++;
    const pecasB = pecasDoRiscoMulti(itens, g.plano.pano, comboB, params).sort(
      (x, y) => y.area - x.area
    );
    const encB = empacotarOrdem(pecasB, b.larguraCm, params.folgaCm, permitir180, "skyline");
    if (encB.pecas.length < pecasB.length || encB.comprimentoCm > params.mesaCm)
      return false; // B estouraria a mesa

    const aEsvazia = Object.keys(comboA).length === 0;
    let encA = { comprimentoCm: 0, pecas: [] as Risco["pecas"] };
    if (!aEsvazia) {
      const pecasA = pecasDoRiscoMulti(itens, g.plano.pano, comboA, params).sort(
        (x, y) => y.area - x.area
      );
      const r = empacotarOrdem(pecasA, a.larguraCm, params.folgaCm, permitir180, "skyline");
      if (r.pecas.length < pecasA.length) return false;
      encA = r;
    }

    // ganha se a soma encurtar (corte eliminado ganha a perda da folha também)
    const antes = a.comprimentoCm + b.comprimentoCm + params.perdaPorFolhaCm * 2;
    const depois =
      encA.comprimentoCm + encB.comprimentoCm + params.perdaPorFolhaCm * (aEsvazia ? 1 : 2);
    if (depois >= antes - 0.5) return false;

    // aplica: atualiza os dois cortes (ou elimina o que esvaziou)
    b.combo = comboB;
    b.rotulo = rotuloDoCombo(itens, comboB);
    b.comprimentoCm = encB.comprimentoCm;
    b.pecas = encB.pecas;
    if (aEsvazia) {
      g.plano.riscos.splice(g.plano.riscos.indexOf(a), 1);
    } else {
      a.combo = comboA;
      a.rotulo = rotuloDoCombo(itens, comboA);
      a.comprimentoCm = encA.comprimentoCm;
      a.pecas = encA.pecas;
    }
    if (!g.plano.estrategiaEnfesto.includes("remanejo"))
      g.plano.estrategiaEnfesto += " + remanejo entre cortes";
    recalcularPlano(g.plano, itens, params);
    return true;
  };

  // ---- fase MELHORIA: busca local nas sequências dos riscos ----
  if (estado.fase === "MELHORIA" && alvos.length > 0) {
    const LIMITE_SEM_MELHORA = 900; // mutações seguidas sem ganho → FINO
    let alvoIdx = 0;
    while (!acabou() && estado.semMelhora < LIMITE_SEM_MELHORA) {
      // de vez em quando, tenta mover roupa ENTRE cortes (mesmas folhas)
      if (rng.next() < 0.25) {
        if (tentarMoverEntreCortes()) {
          estado.semMelhora = 0;
          estado.ganhouNoCiclo = true;
        } else {
          estado.semMelhora++;
        }
        continue;
      }
      // sorteio ponderado: os primeiros alvos (mais impacto) aparecem mais
      const alvosVivos = alvos.filter((al) =>
        al.plano.riscos.includes(al.risco)
      );
      if (alvosVivos.length === 0) break;
      const { plano, risco } =
        alvosVivos[
          rng.next() < 0.6
            ? alvoIdx % Math.min(2, alvosVivos.length)
            : Math.floor(rng.next() * alvosVivos.length)
        ];
      alvoIdx++;

      const seqAtual = sequenciaDoRisco(risco);
      const candidata =
        rng.next() < 0.12
          ? // de vez em quando, recomeço embaralhado: escapa de beco sem saída
            (() => {
              const s = [...seqAtual];
              for (let i = s.length - 1; i > 0; i--) {
                const j = Math.floor(rng.next() * (i + 1));
                [s[i], s[j]] = [s[j], s[i]];
              }
              return s;
            })()
          : mutar(seqAtual, rng);

      estado.tentativas++;
      // avaliação rápida (skyline) com poda no comprimento atual
      const rapida = empacotarOrdem(
        candidata,
        risco.larguraCm,
        params.folgaCm,
        permitir180,
        "skyline",
        risco.comprimentoCm
      );
      if (
        rapida.pecas.length === candidata.length &&
        rapida.comprimentoCm < risco.comprimentoCm - 0.01
      ) {
        estado.ganhouNoCiclo = true;
        // melhorou no rápido: consolida com o motor caro (preenche vãos)
        estado.tentativas++;
        const fina = empacotarOrdem(
          candidata,
          risco.larguraCm,
          params.folgaCm,
          permitir180,
          "grade",
          risco.comprimentoCm
        );
        const venceu =
          fina.pecas.length === candidata.length &&
          fina.comprimentoCm < risco.comprimentoCm - 0.01
            ? fina
            : rapida;
        risco.comprimentoCm = venceu.comprimentoCm;
        risco.pecas = venceu.pecas;
        if (!risco.estrategiaEncaixe.includes("busca local"))
          risco.estrategiaEncaixe += " + busca local";
        recalcularPlano(plano, itens, params);
        estado.semMelhora = 0;
      } else {
        estado.semMelhora++;
      }
    }
    if (estado.semMelhora >= LIMITE_SEM_MELHORA) estado.fase = "FINO";
  }

  // ---- fase FINO: lupa de 0,25cm nos riscos finais ----
  if (estado.fase === "FINO" && !acabou()) {
    for (const { plano, risco } of alvos) {
      if (!plano.riscos.includes(risco)) continue; // corte eliminado no remanejo
      if (acabou()) break;
      estado.tentativas++;
      const fina = empacotarOrdem(
        sequenciaDoRisco(risco),
        risco.larguraCm,
        params.folgaCm,
        permitir180,
        "grade",
        risco.comprimentoCm + 0.01,
        0.25
      );
      if (
        fina.pecas.length === risco.pecas.length &&
        fina.comprimentoCm < risco.comprimentoCm - 0.005
      ) {
        risco.comprimentoCm = fina.comprimentoCm;
        risco.pecas = fina.pecas;
        recalcularPlano(plano, itens, params);
        estado.ganhouNoCiclo = true;
      }
    }
    // fechou uma volta MELHORIA→FINO. Sobrou orçamento? Volta pra MELHORIA
    // com semente nova. Duas voltas seguidas sem NENHUM ganho = convergiu.
    estado.ciclos++;
    const restanteMs = budgetTotalMs - estado.elapsedMs - (Date.now() - inicio);
    if (restanteMs > 12_000 && (estado.ganhouNoCiclo || estado.ciclos < 2)) {
      estado.fase = "MELHORIA";
      estado.semMelhora = 0;
      estado.ganhouNoCiclo = false;
    } else {
      estado.fase = "DONE";
    }
  }

  // ---- fecha a rodada ----
  const gasto = Date.now() - inicio;
  estado.elapsedMs += gasto;
  estado.seed = Math.floor(rng.next() * 0xffffffff) || 1; // continua diferente na próxima
  if (estado.elapsedMs >= budgetTotalMs) estado.fase = "DONE";

  return { estado, resultado };
}

/** Aproveitamento "manchete" do plano (o do tecido principal, ou o maior). */
export function aproveitamentoManchete(resultado: ResultadoPlano): number {
  const tec = resultado.planos.find((p) => p.pano === "TEC");
  return (
    tec?.aproveitamentoMedio ??
    Math.max(0, ...resultado.planos.map((p) => p.aproveitamentoMedio))
  );
}
