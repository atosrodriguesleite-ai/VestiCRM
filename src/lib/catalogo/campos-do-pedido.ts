/**
 * RN-027 · Campos extras do pedido do catálogo, escolhidos POR LOJA.
 *
 * O formulário do catálogo sempre pediu só nome e telefone — mas cada loja
 * despacha de um jeito: uma precisa do CEP para cotar o frete, outra entrega
 * de motoboy e vive de bairro. Em vez de inchar o formulário de todo mundo,
 * a LOJA escolhe (Configurações → Catálogo) quais campos o pedido pergunta,
 * e se cada um é obrigatório.
 *
 * Três decisões que não podem se perder:
 * - **Cardápio fechado**: os campos possíveis são os daqui, cada um caindo
 *   numa coluna da ficha da cliente (`Customer`). Campo livre viraria dado
 *   sem casa — não entra em etiqueta, mapa nem exportação.
 * - **Recorte por lista no servidor** (mesmo padrão da RN-025): a rota do
 *   pedido só aceita os campos que a LOJA configurou. O que vier a mais no
 *   payload é descartado — o navegador não decide o que entra na ficha.
 * - **Obrigatório trava só o NAVEGADOR**: o servidor aceita o pedido mesmo
 *   sem o campo. Pedido do catálogo NÃO PODE SE PERDER (RN-010) — o reenvio
 *   automático guarda o payload antigo, e recusar por falta de CEP perderia
 *   a venda que a trava existe para servir.
 *
 * Loja que não configurar nada não muda em NADA: formulário como sempre foi.
 */

import { siglaDoEstado } from "../envios/estados";

export type CampoDoPedido = "CEP" | "ENDERECO" | "BAIRRO" | "CIDADE" | "ESTADO";

/** Colunas da ficha da cliente que este formulário alcança. */
export type FichaCampo = "zip" | "street" | "streetNumber" | "district" | "city" | "state";

/**
 * O cardápio, num lugar só: rótulo na tela e na mensagem, exemplo, a coluna
 * da ficha onde o dado mora e a CHAVE DO PAYLOAD (`payload`) que viaja do
 * formulário até a rota — derivar tudo daqui é o que impede um campo novo
 * de existir na tela e ser descartado em silêncio no servidor.
 */
export const CAMPOS_DO_PEDIDO: Record<
  CampoDoPedido,
  { rotulo: string; exemplo: string; ficha: FichaCampo; payload: string; max: number }
> = {
  CEP: { rotulo: "CEP", exemplo: "00000-000", ficha: "zip", payload: "cep", max: 20 },
  ENDERECO: { rotulo: "Endereço (rua e número)", exemplo: "Rua das Flores, 123", ficha: "street", payload: "endereco", max: 200 },
  BAIRRO: { rotulo: "Bairro", exemplo: "Centro", ficha: "district", payload: "bairro", max: 120 },
  CIDADE: { rotulo: "Cidade", exemplo: "Sua cidade", ficha: "city", payload: "cidade", max: 120 },
  ESTADO: { rotulo: "Estado (UF)", exemplo: "SP", ficha: "state", payload: "estado", max: 60 },
};

export type ConfigCampo = { campo: CampoDoPedido; obrigatorio: boolean };

/**
 * Lê a configuração gravada na loja (`Company.catalogFormFields`, JSON em
 * texto — mesmo padrão do `categoryOrder`). Tolerante por obrigação: a
 * coluna é escrita por versões diferentes do sistema, e lixo aqui não pode
 * derrubar o catálogo público. Campo desconhecido ou repetido é descartado;
 * qualquer coisa fora do formato devolve lista vazia (= como sempre foi).
 */
export function lerCamposDaLoja(raw: string | null | undefined): ConfigCampo[] {
  if (!raw) return [];
  try {
    const lista = JSON.parse(raw);
    if (!Array.isArray(lista)) return [];
    const vistos = new Set<string>();
    const out: ConfigCampo[] = [];
    for (const item of lista) {
      const campo = item?.campo;
      if (typeof campo !== "string" || !(campo in CAMPOS_DO_PEDIDO) || vistos.has(campo)) continue;
      vistos.add(campo);
      out.push({ campo: campo as CampoDoPedido, obrigatorio: item?.obrigatorio === true });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Recorte por lista: dos dados digitados no formulário, o que a loja
 * CONFIGUROU entra na ficha da cliente — o resto é descartado, venha de
 * onde vier. Devolve só o que tem valor (campo em branco não apaga nada,
 * mesma regra do formulário de funcionário da RN-025).
 */
export function dadosAceitos(
  config: ConfigCampo[],
  digitado: Partial<Record<CampoDoPedido, string | undefined>>
): Partial<Record<FichaCampo, string>> {
  const out: Partial<Record<FichaCampo, string>> = {};
  for (const { campo } of config) {
    const def = CAMPOS_DO_PEDIDO[campo];
    const bruto = (digitado[campo] ?? "").trim().replace(/\s+/g, " ").slice(0, def.max);
    if (!bruto) continue;
    if (campo === "ESTADO") {
      // "alagoas", "São Paulo", "sp" — tudo vira a sigla; o que não é UF
      // conhecida fica como veio (etiqueta e NF-e vão reclamar com motivo)
      out.state = siglaDoEstado(bruto) ?? bruto;
    } else if (campo === "ENDERECO") {
      // a ficha separa rua e número (a régua da etiqueta exige os dois):
      // "Rua das Flores, 123" / "Rua A 45" / "Av. B, s/n" são separados;
      // sem número reconhecível, tudo fica na rua — a compra da etiqueta
      // continua pedindo o número, como sempre pediu
      const m =
        bruto.match(/^(.+?),\s*(\d+\s?[a-zA-Z]?|s\/?n\.?)\s*$/i) ??
        bruto.match(/^(.+?)\s+(\d+\s?[a-zA-Z]?)$/);
      if (m) {
        out.street = m[1].trim();
        out.streetNumber = m[2].trim();
      } else {
        out.street = bruto;
      }
    } else {
      out[def.ficha] = bruto;
    }
  }
  return out;
}
