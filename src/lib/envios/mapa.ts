/**
 * MAPA DE ENVIOS — o BI "para onde a loja vende" da tela Envios.
 *
 * Cada etiqueta comprada já guarda cidade e UF da destinatária
 * (Shipping.city/state, preenchidos na compra) — o mapa nasce disso, sem
 * consultar serviço externo nenhum: as coordenadas dos 5.570 municípios
 * (municipios-xy.json) e o contorno dos estados (mapa-brasil.json) foram
 * gerados uma vez por scripts/gerar-mapa-envios.mjs e moram no repositório.
 *
 * Este arquivo importa a base de municípios (~170 KB) e por isso é SÓ DO
 * SERVIDOR — a tela recebe os pontos prontos, já projetados no viewBox.
 *
 * A cidade vem de cadastro digitado: o casamento com a base ignora acento e
 * maiúscula (normalizarBusca). Cidade que não casa NÃO some do mapa — vira
 * um ponto no centro do estado (cidade: null), porque envio sem bolinha
 * faria a lojista achar que o mapa mente. UF inválida (não é uma das 27)
 * fica de fora por completo: não há onde desenhar.
 */

import { normalizarBusca } from "../busca";
import { NOME_DO_ESTADO } from "./estados";
import mapaBrasil from "./mapa-brasil.json";
import municipiosXy from "./municipios-xy.json";

const XY = municipiosXy as Record<string, number[]>;
const UFS = (mapaBrasil as { ufs: Record<string, { d: string; centro: number[] }> }).ufs;

export { NOME_DO_ESTADO };

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
    const uf = (e.uf ?? "").trim().toUpperCase();
    if (!UFS[uf]) {
      semEndereco += e.quantidade; // sem UF válida não há onde desenhar
      continue;
    }

    porUf.set(uf, (porUf.get(uf) ?? 0) + e.quantidade);

    const cidade = (e.cidade ?? "").trim();
    const xy = cidade ? XY[`${normalizarBusca(cidade)}|${uf}`] : undefined;
    // cidade não casada agrega no centro do estado (uma bolinha por UF)
    const chave = xy ? `${normalizarBusca(cidade)}|${uf}` : `~centro|${uf}`;
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
 * Vale o endereço do ENVIO quando ele existe — é o que foi de fato usado na
 * etiqueta, e a cliente pode ter mudado de endereço depois. Sem ele, vale o
 * cadastro da cliente: pedido despachado por motoboy/transportadora própria
 * nasce com registro de envio SEM cidade (só data de saída), e sem esta
 * queda o mapa "geral" mostraria quase nada.
 *
 * As duas fontes NUNCA se misturam: cidade de uma com UF da outra poria a
 * bolinha na cidade errada. Quem manda na escolha é a UF (sem UF não há
 * onde desenhar), e a cidade vem junto dela.
 */
export function enderecoDoPedido(pedido: {
  shipping: { city: string | null; state: string | null } | null;
  customer: { city: string | null; state: string | null } | null;
}): { cidade: string | null; uf: string | null } {
  const doEnvio = pedido.shipping?.state?.trim();
  if (doEnvio) return { cidade: pedido.shipping?.city ?? null, uf: doEnvio };
  const daCliente = pedido.customer?.state?.trim();
  if (daCliente) return { cidade: pedido.customer?.city ?? null, uf: daCliente };
  return { cidade: null, uf: null };
}
