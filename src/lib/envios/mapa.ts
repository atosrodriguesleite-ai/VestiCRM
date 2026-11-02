/**
 * MAPA DE ENVIOS — o BI "para onde a loja vende" da tela Envios.
 *
 * O destino de cada pedido vem da ETIQUETA (quando houve) ou da ficha da
 * cliente — o mapa nasce disso, sem consultar serviço externo nenhum: as
 * coordenadas dos 5.570 municípios
 * (municipios-xy.json) e o contorno dos estados (mapa-brasil.json) foram
 * gerados uma vez por scripts/gerar-mapa-envios.mjs e moram no repositório.
 *
 * Este arquivo importa a base de municípios (~170 KB) e por isso é SÓ DO
 * SERVIDOR — a tela recebe os pontos prontos, já projetados no viewBox.
 *
 * A cidade vem de cadastro digitado: o casamento com a base ignora acento,
 * maiúscula, hífen e apóstrofo. Cidade que não casa NÃO some do mapa — vira
 * um ponto no centro do estado (cidade: null), porque envio sem bolinha
 * faria a lojista achar que o mapa mente. A UF aceita sigla ou nome por
 * extenso (a Nuvemshop grava "Minas Gerais"); o que não vira sigla é
 * CONTADO em `semEndereco` e dito na tela, nunca sumido em silêncio.
 */

import { normalizarBusca } from "../busca";
import { NOME_DO_ESTADO, siglaDoEstado } from "./estados";
import mapaBrasil from "./mapa-brasil.json";
import municipiosXy from "./municipios-xy.json";

const UFS = (mapaBrasil as { ufs: Record<string, { d: string; centro: number[] }> }).ufs;

export { NOME_DO_ESTADO };

/**
 * Chave de cidade tolerante ao jeito de escrever: além de acento e maiúscula
 * (normalizarBusca), hífen e apóstrofo somem. "Sant'Ana do Livramento",
 * "Santana do Livramento", "Biritiba-Mirim" e "Biritiba Mirim" são a mesma
 * cidade — e sem isso a bolinha ia calada para o centro do estado.
 */
const chaveCidade = (cidade: string, uf: string) =>
  `${normalizarBusca(cidade)
    .replace(/['’]/g, "") // apóstrofo COLA: "Sant'Ana" = "Santana"
    .replace(/[-.]/g, " ") // hífen e ponto SEPARAM: "Biritiba-Mirim" = "Biritiba Mirim"
    .replace(/\s+/g, " ")
    .trim()}|${uf}`;

// a base é gerada com a chave crua; reindexada aqui pela chave tolerante
const XY = new Map<string, number[]>();
for (const [chave, ponto] of Object.entries(municipiosXy as Record<string, number[]>)) {
  const [cidade, uf] = chave.split("|");
  XY.set(chaveCidade(cidade, uf), ponto);
}

// a tradução de nome/sigla mudou-se para estados.ts (módulo leve): o
// formulário do catálogo também precisa dela, e daqui viriam os ~170 KB
// de municípios junto. Re-exportada para os chamadores antigos.
export { siglaDoEstado };

export type EnvioLocalizado = {
  cidade: string | null;
  uf: string | null;
  quantidade: number;
};

export type MapaEnvios = {
  /** só estados com 1+ envio, do maior para o menor (é a lista da tela) */
  porUf: { uf: string; nome: string; quantidade: number }[];
  /** bolinhas: cidade casada na base OU centro do estado (cidade: null) */
  pontos: { x: number; y: number; cidade: string | null; uf: string; quantidade: number }[];
  total: number;
  /**
   * Quantos ficaram FORA do mapa por não ter UF cadastrada. O mapa conta isso
   * em voz alta: sem o aviso, a lojista compara com a tela de Pedidos, vê
   * menos bolinha do que pedido e conclui que o mapa mente.
   */
  semEndereco: number;
};

export function montarMapaEnvios(envios: EnvioLocalizado[]): MapaEnvios {
  const porUf = new Map<string, number>();
  const pontos = new Map<string, { x: number; y: number; cidade: string | null; uf: string; quantidade: number }>();

  let semEndereco = 0;
  for (const e of envios) {
    if (!e.quantidade) continue;
    const uf = siglaDoEstado(e.uf);
    if (!uf) {
      semEndereco += e.quantidade; // sem UF válida não há onde desenhar
      continue;
    }

    porUf.set(uf, (porUf.get(uf) ?? 0) + e.quantidade);

    const cidade = (e.cidade ?? "").trim();
    const xy = cidade ? XY.get(chaveCidade(cidade, uf)) : undefined;
    // cidade não casada agrega no centro do estado (uma bolinha por UF)
    const chave = xy ? chaveCidade(cidade, uf) : `~centro|${uf}`;
    const atual = pontos.get(chave);
    if (atual) {
      atual.quantidade += e.quantidade;
    } else {
      const [x, y] = xy ?? UFS[uf].centro;
      pontos.set(chave, {
        x, y,
        cidade: xy ? cidade : null,
        uf,
        quantidade: e.quantidade,
      });
    }
  }

  const lista = [...porUf.entries()]
    .map(([uf, quantidade]) => ({ uf, nome: NOME_DO_ESTADO[uf] ?? uf, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));

  return {
    porUf: lista,
    pontos: [...pontos.values()].sort((a, b) => b.quantidade - a.quantidade),
    total: lista.reduce((s, e) => s + e.quantidade, 0),
    semEndereco,
  };
}

/**
 * DE ONDE SAI O ENDEREÇO DE UM PEDIDO PAGO (modo "todos os pedidos").
 *
 * Vale o endereço da ETIQUETA quando houve etiqueta — é o que foi impresso e
 * para onde a caixa foi mesmo. Fora isso vale a FICHA da cliente: todo pedido
 * montado no sistema nasce com uma cópia do endereço da ficha, e cópia
 * envelhece (corrigir a UF errada na ficha precisa chegar ao mapa); e o
 * pedido despachado por motoboy/transportadora própria nasce com registro de
 * envio sem cidade nenhuma, só data de saída.
 *
 * As duas fontes NUNCA se misturam: cidade de uma com UF da outra poria a
 * bolinha na cidade errada. Quem manda na escolha é a UF (sem UF não há
 * onde desenhar), e a cidade vem junto dela.
 */
export function enderecoDoPedido(pedido: {
  shipping: { city: string | null; state: string | null; meOrderId?: string | null } | null;
  customer: { city: string | null; state: string | null } | null;
}): { cidade: string | null; uf: string | null } {
  // O endereço do envio só manda quando saiu ETIQUETA: aí ele é o que foi
  // impresso e para onde a caixa foi mesmo. Todo pedido montado no sistema
  // nasce com uma CÓPIA do endereço da ficha (api/orders), e essa cópia
  // envelhece — corrigir a UF errada na ficha nunca chegava ao mapa, que
  // seguia apontando o estado antigo (achado da revisão).
  const comEtiqueta = Boolean(pedido.shipping?.meOrderId);
  const doEnvio = pedido.shipping?.state?.trim();
  if (comEtiqueta && doEnvio)
    return { cidade: pedido.shipping?.city ?? null, uf: doEnvio };

  const daCliente = pedido.customer?.state?.trim();
  if (daCliente) return { cidade: pedido.customer?.city ?? null, uf: daCliente };

  // ficha sem estado: a cópia do envio ainda é melhor que nada
  if (doEnvio) return { cidade: pedido.shipping?.city ?? null, uf: doEnvio };
  return { cidade: null, uf: null };
}

/** Um pacote a caminho, para a camada "na estrada" (RN-103). */
export type PacoteNaEstrada = {
  cidade: string | null;
  uf: string | null;
  /**
   * a situação pela régua da RN-102: "atrasado" = passou da previsão da
   * transportadora; "parado" = sem prazo e postado há mais de 7 dias (a tela
   * NUNCA chama este de atrasado — não há prazo que ele tenha furado)
   */
  situacao: "no-prazo" | "atrasado" | "parado";
};

export type PontoNaEstrada = {
  x: number;
  y: number;
  cidade: string | null;
  uf: string;
  noPrazo: number;
  atrasados: number;
  parados: number;
};

export type MapaNaEstrada = {
  /** de onde os pacotes saem: o remetente do Melhor Envio (sem UF válida, nulo — e sem arco) */
  origem: { x: number; y: number; cidade: string | null; uf: string } | null;
  /** um ponto por cidade de destino, com quantos estão no prazo, atrasados e parados */
  pontos: PontoNaEstrada[];
  porUf: { uf: string; nome: string; quantidade: number; atrasados: number; parados: number }[];
  total: number;
  atrasados: number;
  parados: number;
  /** pacotes sem UF válida — contados e ditos, nunca sumidos (a régua do mapa) */
  semEndereco: number;
  /** a leitura bateu no teto: o mapa mostra os mais antigos e a tela diz */
  cortado: boolean;
};

/**
 * A CAMADA "NA ESTRADA" (RN-103): só o que está POSTADO e ainda não chegou,
 * agregado por cidade de destino com a situação de cada pacote (no prazo ×
 * atrasado × parado, decidida por quem chama, pela régua da RN-102). A tela
 * desenha um arco do remetente até cada cidade e pinta de vermelho a que tem
 * pacote atrasado e de âmbar a que só tem parado — a cor faz UM trabalho: o
 * status (RN-089). A cidade que não casa com a base vai para o centro do
 * estado, como no mapa de sempre.
 */
export function montarNaEstrada(
  pacotes: PacoteNaEstrada[],
  remetente: { cidade: string | null; uf: string | null } | null,
  opcoes: { cortado?: boolean } = {}
): MapaNaEstrada {
  const pontos = new Map<string, PontoNaEstrada>();
  const porUf = new Map<string, { quantidade: number; atrasados: number; parados: number }>();
  let semEndereco = 0;
  let atrasados = 0;
  let parados = 0;
  for (const p of pacotes) {
    const uf = siglaDoEstado(p.uf);
    if (!uf) {
      semEndereco += 1;
      continue;
    }
    if (p.situacao === "atrasado") atrasados += 1;
    if (p.situacao === "parado") parados += 1;
    const acc = porUf.get(uf) ?? { quantidade: 0, atrasados: 0, parados: 0 };
    acc.quantidade += 1;
    if (p.situacao === "atrasado") acc.atrasados += 1;
    if (p.situacao === "parado") acc.parados += 1;
    porUf.set(uf, acc);

    const cidade = (p.cidade ?? "").trim();
    const xy = cidade ? XY.get(chaveCidade(cidade, uf)) : undefined;
    const chave = xy ? chaveCidade(cidade, uf) : `~centro|${uf}`;
    const ponto = pontos.get(chave) ?? {
      x: (xy ?? UFS[uf].centro)[0],
      y: (xy ?? UFS[uf].centro)[1],
      cidade: xy ? cidade : null,
      uf,
      noPrazo: 0,
      atrasados: 0,
      parados: 0,
    };
    if (p.situacao === "atrasado") ponto.atrasados += 1;
    else if (p.situacao === "parado") ponto.parados += 1;
    else ponto.noPrazo += 1;
    pontos.set(chave, ponto);
  }

  let origem: MapaNaEstrada["origem"] = null;
  const ufOrigem = siglaDoEstado(remetente?.uf ?? null);
  if (ufOrigem) {
    const cidade = (remetente?.cidade ?? "").trim();
    const xy = cidade ? XY.get(chaveCidade(cidade, ufOrigem)) : undefined;
    const [x, y] = xy ?? UFS[ufOrigem].centro;
    origem = { x, y, cidade: xy ? cidade : null, uf: ufOrigem };
  }

  const lista = [...porUf.entries()]
    .map(([uf, v]) => ({ uf, nome: NOME_DO_ESTADO[uf] ?? uf, ...v }))
    .sort((a, b) => b.atrasados - a.atrasados || b.parados - a.parados || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));

  // ordem de desenho: no prazo embaixo, parado no meio, atrasado por cima —
  // o que precisa de ação nunca some embaixo de uma bolinha maior
  const peso = (p: PontoNaEstrada) => (p.atrasados > 0 ? 2 : p.parados > 0 ? 1 : 0);
  return {
    origem,
    pontos: [...pontos.values()].sort(
      (a, b) => peso(a) - peso(b) || b.noPrazo + b.atrasados + b.parados - (a.noPrazo + a.atrasados + a.parados)
    ),
    porUf: lista,
    total: lista.reduce((s, e) => s + e.quantidade, 0),
    atrasados,
    parados,
    semEndereco,
    cortado: Boolean(opcoes.cortado),
  };
}
