import type { PlanoPano } from "./types";

/**
 * Resumo de corte — a "lista de conferência" que a cortadeira leva pra mesa.
 *
 * O plano fala em metros e folhas; quem está cortando pensa em PEÇAS: quantas
 * mangas, quantas golas, quantas frentes vão sair no total. Este resumo
 * traduz o plano nessa contagem, pra conferir a pilha no fim do corte e
 * saber o que mandar pra costura/facção.
 *
 * A conta é sempre: peças no risco × folhas enfestadas daquele risco.
 */

export type LinhaPeca = {
  nome: string; // nome da peça ("MANGA")
  modelo?: string; // preenchido no plano com vários modelos
  pano: "TEC" | "FOR";
  porRoupa: number; // quantas vezes sai por roupa (2 na manga)
  total: number; // peças a cortar no corte inteiro
  porTamanho: Record<string, number>; // quebra por tamanho (pra conferir)
};

export type LinhaTamanho = {
  tamanho: string;
  roupas: number; // roupas prontas daquele tamanho
  pecas: number; // peças a cortar daquele tamanho
};

/**
 * Um modelo do corte. Cada modelo tem a SUA contagem de itens por roupa —
 * uma baby look de 5 peças e uma regata de 4 não viram "4,5 peças".
 */
export type LinhaModelo = {
  modelo?: string; // undefined quando o corte tem um modelo só
  roupas: number;
  pecas: number;
  pecasPorRoupa: number;
};

export type ResumoCorte = {
  totalPecas: number; // TODAS as peças a cortar (a pilha inteira)
  totalRoupas: number; // roupas que essas peças formam
  porModelo: LinhaModelo[]; // itens por roupa de CADA modelo
  porPeca: LinhaPeca[]; // maior primeiro
  porTamanho: LinhaTamanho[];
  /**
   * Placar das curvas NO PLANO REAL: quantas peças entraram no risco com o
   * desenho de verdade e quantas como retângulo (sem PDF casado naquele
   * tamanho). Retângulo derruba o aproveitamento — este número diz se o
   * gargalo é dado ou algoritmo.
   */
  pecasComCurva: number;
  pecasComoRetangulo: number;
};

/** Separa "MANGA · BABY LOOK" em peça e modelo (plano multi-modelo). */
function abrirNome(nome: string): { peca: string; modelo?: string } {
  const i = nome.indexOf(" · ");
  return i < 0
    ? { peca: nome }
    : { peca: nome.slice(0, i), modelo: nome.slice(i + 3) };
}

/**
 * No plano multi-modelo a chave de tamanho vem como "0|M" — o número antes
 * da barra é o modelo. Devolve os dois separados.
 */
function abrirChave(chave: string): { idx: number; tamanho: string } {
  const i = chave.indexOf("|");
  return i < 0
    ? { idx: 0, tamanho: chave.trim() }
    : { idx: parseInt(chave.slice(0, i), 10) || 0, tamanho: chave.slice(i + 1).trim() };
}

/**
 * Monta o resumo a partir dos planos já otimizados (tecido e forro juntos —
 * do ponto de vista de quem confere a mesa, a pilha é uma só).
 */
export function resumoDeCorte(planos: PlanoPano[]): ResumoCorte {
  const porChave = new Map<string, LinhaPeca & { idx: number }>();
  const porTam = new Map<string, LinhaTamanho>();
  // roupas por modelo e por tamanho: contadas UMA vez (o risco do forro
  // repete a mesma grade e não gera roupa a mais)
  const roupasPorModelo = new Map<number, number>();
  const roupasPorTam = new Map<string, number>();
  const planoDaGrade = planos[0]; // o primeiro pano já carrega a grade toda

  let pecasComCurva = 0;
  let pecasComoRetangulo = 0;

  for (const plano of planos) {
    for (const risco of plano.riscos) {
      for (const p of risco.pecas) {
        if (p.contorno && p.contorno.length >= 3) pecasComCurva += risco.folhas;
        else pecasComoRetangulo += risco.folhas;
        const { peca, modelo } = abrirNome(p.nome);
        const { tamanho } = abrirChave(p.tamanho);
        const idx = p.modeloIdx ?? 0;
        const chave = `${plano.pano}|${idx}|${peca}`;
        const linha = porChave.get(chave) ?? {
          nome: peca,
          modelo,
          pano: plano.pano,
          porRoupa: 0,
          total: 0,
          porTamanho: {} as Record<string, number>,
          idx,
        };
        linha.total += risco.folhas;
        linha.porTamanho[tamanho] = (linha.porTamanho[tamanho] ?? 0) + risco.folhas;
        porChave.set(chave, linha);

        const t = porTam.get(tamanho) ?? { tamanho, roupas: 0, pecas: 0 };
        t.pecas += risco.folhas;
        porTam.set(tamanho, t);
      }

      if (plano === planoDaGrade)
        for (const [chave, vezes] of Object.entries(risco.combo)) {
          const { idx, tamanho } = abrirChave(chave);
          const roupas = risco.folhas * vezes;
          roupasPorModelo.set(idx, (roupasPorModelo.get(idx) ?? 0) + roupas);
          roupasPorTam.set(tamanho, (roupasPorTam.get(tamanho) ?? 0) + roupas);
        }
    }
  }

  for (const [tamanho, roupas] of roupasPorTam) {
    const t = porTam.get(tamanho) ?? { tamanho, roupas: 0, pecas: 0 };
    t.roupas = roupas;
    porTam.set(tamanho, t);
  }

  // quantas vezes cada peça sai POR ROUPA: total ÷ roupas DAQUELE modelo
  for (const linha of porChave.values()) {
    const roupas = roupasPorModelo.get(linha.idx) ?? 0;
    linha.porRoupa = roupas > 0 ? Math.round((linha.total / roupas) * 100) / 100 : 0;
  }

  // um bloco por modelo: cada um com os SEUS itens por roupa (uma baby look
  // de 5 peças e uma regata de 4 nunca viram "4,5 peças por roupa")
  const porModelo: LinhaModelo[] = [...roupasPorModelo.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, roupas]) => {
      const linhas = [...porChave.values()].filter((l) => l.idx === idx);
      return {
        modelo: linhas[0]?.modelo,
        roupas,
        pecas: linhas.reduce((s, l) => s + l.total, 0),
        pecasPorRoupa:
          Math.round(linhas.reduce((s, l) => s + l.porRoupa, 0) * 100) / 100,
      };
    });

  const porPeca = [...porChave.values()]
    .map(({ idx: _idx, ...l }) => l)
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  return {
    totalPecas: porPeca.reduce((s, l) => s + l.total, 0),
    totalRoupas: [...roupasPorModelo.values()].reduce((s, v) => s + v, 0),
    porModelo,
    porPeca,
    porTamanho: [...porTam.values()].sort((a, b) =>
      a.tamanho.localeCompare(b.tamanho)
    ),
    pecasComCurva,
    pecasComoRetangulo,
  };
}
