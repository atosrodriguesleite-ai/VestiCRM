/**
 * MODO TV DOS ENVIOS — a regra pura (RN-104), sem banco e sem three.js, para
 * o navegador importar e o teste prender.
 *
 * O Modo TV é a tela cheia que fica ligada na loja: o mapa 3D dos pacotes
 * a caminho (a camada "na estrada" da RN-103, com a situação de cada cidade
 * pela régua da RN-102) e o placar do dia. Tudo aqui é conta de tela — o que
 * é dinheiro ou regra de atraso mora nas RNs de origem; este arquivo só
 * traduz para o desenho e para o texto.
 */
import type { MapaNaEstrada, PacoteNaEstrada, PontoNaEstrada } from "./mapa";
import { DIAS_PARA_PARADO } from "./painel";

/** o lado do viewBox do mapa (mapa-brasil.json: "0 0 620 620") */
export const LADO_DO_MAPA = 620;

/** cores de STATUS, as mesmas do mapa 2D (RN-089: vermelho e âmbar são status) */
export const CORES_TV = {
  noPrazo: "#e0803f",
  atrasado: "#ff3b5c",
  parado: "#ffb020",
  loja: "#ffffff",
} as const;

/**
 * Do viewBox 2D (x para a direita, y para baixo) ao chão 3D (x para a
 * direita, z para "perto da câmera"): o centro do mapa vira a origem — é o
 * que faz a câmera girar em volta do Brasil, não de um canto dele.
 */
export function para3d(x: number, y: number): { x: number; z: number } {
  const meio = LADO_DO_MAPA / 2;
  return { x: x - meio, z: y - meio };
}

/** a altura da coluna de luz de uma cidade: cresce com a raiz, para 1 e 40 caberem na mesma tela */
export function alturaDaColuna(pacotes: number): number {
  return 8 + Math.sqrt(Math.max(0, pacotes)) * 9;
}

/** a cor de STATUS de uma cidade: o pior caso ali decide (a régua do mapa 2D) */
export function corDaCidade(p: { atrasados: number; parados: number }): string {
  return p.atrasados > 0 ? CORES_TV.atrasado : p.parados > 0 ? CORES_TV.parado : CORES_TV.noPrazo;
}

/** total de pacotes de um ponto */
export const totalDoPonto = (p: PontoNaEstrada) => p.noPrazo + p.atrasados + p.parados;

/**
 * Quais cidades ganham RÓTULO na TV: as que têm problema primeiro (é para
 * isso que a TV existe), depois as maiores; o teto evita a nuvem de texto
 * numa loja que manda para cinquenta cidades.
 */
export function rotulosDaTv(pontos: PontoNaEstrada[], quantos: number): PontoNaEstrada[] {
  const peso = (p: PontoNaEstrada) => (p.atrasados > 0 ? 2 : p.parados > 0 ? 1 : 0);
  return [...pontos]
    .sort((a, b) => peso(b) - peso(a) || totalDoPonto(b) - totalDoPonto(a) || (a.cidade ?? a.uf).localeCompare(b.cidade ?? b.uf))
    .slice(0, Math.max(0, quantos));
}

/** o texto do rótulo de uma cidade: "Manaus · 1 atrasado", "Recife · 3" */
export function textoDoRotulo(p: PontoNaEstrada): string {
  const nome = p.cidade ?? `${p.uf} (cidade não identificada)`;
  const partes: string[] = [];
  if (p.atrasados > 0) partes.push(`${p.atrasados} atrasado${p.atrasados === 1 ? "" : "s"}`);
  if (p.parados > 0) partes.push(`${p.parados} parado${p.parados === 1 ? "" : "s"}`);
  if (partes.length === 0) partes.push(String(totalDoPonto(p)));
  return `${nome} · ${partes.join(" · ")}`;
}

export type PlacarDaTv = {
  aCaminho: number;
  atrasados: number;
  parados: number;
  postadosHoje: number;
  entreguesHoje: number;
  aguardandoPostagem: number;
};

/**
 * O placar conta TODOS os pacotes lidos — o pacote sem UF no cadastro fica
 * fora do MAPA (`semEndereco`), mas está na estrada do mesmo jeito; contar
 * só o mapa diria "nenhum a caminho" com cinco caixas na rua.
 */
export function placarDaTv(
  pacotes: Pick<PacoteNaEstrada, "situacao">[],
  dia: Pick<PlacarDaTv, "postadosHoje" | "entreguesHoje" | "aguardandoPostagem">,
): PlacarDaTv {
  let atrasados = 0;
  let parados = 0;
  for (const p of pacotes) {
    if (p.situacao === "atrasado") atrasados++;
    else if (p.situacao === "parado") parados++;
  }
  return { aCaminho: pacotes.length, atrasados, parados, ...dia };
}

/** a frase embaixo do placar: o que precisa de ação, ou "tudo no prazo" */
export function fraseDoPlacar(p: PlacarDaTv): string {
  if (p.aCaminho === 0) return "Nenhum pacote a caminho agora.";
  const partes: string[] = [];
  if (p.atrasados > 0) partes.push(`${p.atrasados} atrasado${p.atrasados === 1 ? "" : "s"} — passou do prazo da transportadora`);
  // o "7" é o da régua antiga (RN-102), nunca um número solto aqui
  if (p.parados > 0) partes.push(`${p.parados} parado${p.parados === 1 ? "" : "s"} há mais de ${DIAS_PARA_PARADO} dias (sem prazo)`);
  return partes.length ? partes.join(" · ") : "Tudo no prazo. 🚚";
}

/**
 * O que a TV diz quando a batida falha (a régua da faixa "hoje" do BI,
 * RN-088, com o texto DESTA tela: 403/404 aqui é o módulo Envios, não o BI).
 */
export function avisoDaFalhaDaTv(status: number | null): string {
  if (status === 401) return "sua sessão venceu — entre de novo em outra aba";
  if (status === 403 || status === 404) return "o módulo Envios não está mais disponível para você";
  return "sem conexão";
}

/**
 * A "foto" dos dados que o mapa 3D desenha: a TV pede de novo a cada
 * minuto e quase sempre nada mudou — remontar colunas, arcos e rótulos à
 * toa é trabalho de GPU que uma TV ligada o dia inteiro não precisa fazer.
 */
export function impressaoDaEstrada(e: MapaNaEstrada): string {
  return JSON.stringify([e.origem, e.pontos, e.porUf, e.cortado]);
}

/** a TV abre sozinha com `?tv=1` (o endereço que fica salvo na TV da loja) */
export function deveAbrirTv(busca: string): boolean {
  const v = new URLSearchParams(busca).get("tv");
  return v === "1" || v === "true";
}

/** a TV é a camada "na estrada": sem pacote nenhum, o mapa fica apagado e o placar diz */
export function temPacoteNaTela(estrada: Pick<MapaNaEstrada, "total">): boolean {
  return estrada.total > 0;
}
