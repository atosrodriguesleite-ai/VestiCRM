/**
 * Plano de Corte Inteligente — tipos compartilhados.
 *
 * O módulo lê arquivos do CAD (Audaces .adsx e DXF), guarda o modelo com
 * suas peças/grade e monta planos de corte otimizados (riscos + enfesto).
 * Todas as medidas internas são em CENTÍMETROS — mesma unidade do Audaces.
 */

/** Em qual pano a peça é cortada. Tecido e forro têm riscos separados. */
export type TipoPano = "TEC" | "FOR";

/** Contorno fechado da peça (polilinha em cm, origem no canto da peça). */
export type Contorno = [number, number][];

/** Medidas de uma peça em UM tamanho da grade. */
export type MedidaTamanho = {
  w: number; // largura da caixa da peça (cm)
  h: number; // altura da caixa da peça (cm)
  area: number; // área real da peça (cm²) — do Audaces quando disponível
  contorno?: Contorno; // curva real (só quando o modelo veio de DXF)
};

/** Peça do molde (ex.: FRENTE, COSTAS FOR) com medidas por tamanho. */
export type PecaModelo = {
  nome: string;
  pano: TipoPano; // TEC = tecido principal, FOR = forro
  qtd: number; // quantas vezes a peça é cortada por roupa (QT_MOD)
  desc?: string; // descrição original do CAD ("1 X TEC")
  tamanhos: Record<string, MedidaTamanho>;
};

/** Modelo importado do CAD, pronto pra virar plano de corte. */
export type ModeloCorte = {
  nome: string;
  origem: "ADSX" | "DXF";
  tamanhos: string[]; // ordem da grade: ["P", "M", "G", "GG"]
  pecas: PecaModelo[];
  thumbnail?: string; // data-URL (miniatura que vem dentro do .adsx)
};

/** Parâmetros que o lojista informa pra montar o plano. */
export type ParametrosPlano = {
  grade: Record<string, number>; // { P: 30, M: 50, ... } roupas por tamanho
  larguraTecidoCm: number; // largura útil do tecido principal
  larguraForroCm?: number; // largura do forro (padrão: mesma do tecido)
  mesaCm: number; // comprimento útil da mesa de corte
  folgaCm: number; // respiro entre peças no risco
  maxFolhas: number; // altura máxima do enfesto (folhas por vez)
  perdaPorFolhaCm: number; // perda de borda/emenda por folha enfestada
  incluirForro: boolean; // liga/desliga as peças de forro
  pecasDesligadas: string[]; // nomes de peças excluídas do plano
  // Tecido com sentido (estampa direcional, veludo): proíbe girar 180° —
  // toda peça sai "de pé", no sentido único do tecido.
  sentidoUnico?: boolean;
};

/** Uma peça posicionada dentro de um risco. */
export type Posicionamento = {
  nome: string;
  tamanho: string;
  x: number; // cm, canto esquerdo
  y: number; // cm, a partir do início do risco
  w: number;
  h: number;
  rot: 0 | 180; // rotação aplicada (fio do tecido só permite 180°)
  contorno?: Contorno;
};

/** Um risco (marker): a folha desenhada que se repete a cada folha do enfesto. */
export type Risco = {
  // tamanhos no risco e proporção. Plano de 1 modelo: chave = tamanho
  // ("M"); plano multi-modelo: chave composta "índiceDoModelo|tamanho"
  // ("0|M") — use `rotulo` pra exibir.
  combo: Record<string, number>;
  rotulo?: string; // versão legível do combo ("2× BABY LOOK M + REGATA G")
  folhas: number; // quantas folhas enfestar deste risco
  enfestos: number; // em quantos enfestos as folhas se dividem (maxFolhas)
  comprimentoCm: number;
  larguraCm: number;
  aproveitamento: number; // % área de peça / área do risco
  pecas: Posicionamento[];
  estrategiaEncaixe: string; // qual empacotador venceu neste risco
};

/** Plano completo de um pano (tecido OU forro). */
export type PlanoPano = {
  pano: TipoPano;
  riscos: Risco[];
  totalTecidoCm: number; // metros lineares totais (folhas × comprimento + perdas)
  areaPecasCm2: number;
  aproveitamentoMedio: number;
  estrategiaEnfesto: string; // nome da estratégia de enfesto vencedora
  comparativo: { estrategia: string; totalTecidoCm: number }[]; // todas analisadas
  avisos: string[];
};

/** Resultado final: um plano por pano + resumo. */
export type ResultadoPlano = {
  planos: PlanoPano[];
  totalPecasRoupa: number; // roupas produzidas (soma da grade)
  analises: number; // quantas combinações estratégia×encaixe foram avaliadas
};
