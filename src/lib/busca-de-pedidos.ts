import { Prisma } from "@prisma/client";
import { db } from "./db";
import { normalizarBusca } from "./busca";
import { phoneMatchVariants } from "./intake";

/**
 * Busca INTELIGENTE da tela Pedidos: um campo só, e o sistema entende o que
 * foi digitado — a vendedora não deveria precisar saber a diferença.
 *
 * A régua de desempate (número curto × telefone) é o comprimento: código de
 * pedido tem até 6 dígitos (loja com 1 milhão de pedidos não é o nosso
 * problema hoje); 7+ dígitos só existe como telefone. "#" na frente força
 * código, como sempre foi.
 *
 * O telefone casa com a MESMA tolerância do resto do sistema
 * (`phoneMatchVariants`, RN-008): com/sem 9º dígito, com/sem DDI, e cadastro
 * antigo gravado com formatação. O nome casa sem acento e sem caixa
 * (`normalizarBusca`, mesmo padrão da lupa do WhatsApp) — e olha também o
 * nome do WhatsApp e a razão social, que são os nomes pelos quais a loja
 * conhece a cliente.
 */

export type BuscaDePedidos =
  | { tipo: "codigo"; numero: number }
  | { tipo: "telefone"; digitos: string }
  | { tipo: "nome"; texto: string };

export function classificarBusca(q: string): BuscaDePedidos {
  const texto = q.trim();
  const digitos = texto.replace(/\D/g, "");
  // "só números" tolera a decoração usual de telefone: (82) 99999-1234, +55…
  const soNumeros = digitos.length > 0 && /^[#\s\d().+-]*$/.test(texto);
  if (texto.startsWith("#") || (soNumeros && digitos.length <= 6)) {
    const numero = Number(digitos);
    // teto do INT4 do Postgres: "#" com um telefone colado atrás virava um
    // número gigante e a consulta ESTOURAVA — código impossível devolve
    // lista vazia, nunca erro
    const valido = Number.isFinite(numero) && numero > 0 && numero <= 2147483647;
    return { tipo: "codigo", numero: valido ? numero : -1 };
  }
  if (soNumeros) return { tipo: "telefone", digitos };
  return { tipo: "nome", texto };
}

/** Teto de clientes casados: mantém o `IN` da consulta de pedidos saudável. */
const TETO_CLIENTES = 500;

/** Tradução de acentos DENTRO do banco (pt-BR), o par do `normalizarBusca`. */
const COM_ACENTO = "áàâãäéèêëíìîïóòôõöúùûüçñ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucn";

/** Estourou o teto? Corta e AVISA — resultado capado em silêncio some pedido. */
function comTeto(ids: string[]): { ids: string[]; estourou: boolean } {
  return { ids: ids.slice(0, TETO_CLIENTES), estourou: ids.length > TETO_CLIENTES };
}

/**
 * IDs dos clientes DA LOJA que casam com a busca (telefone ou nome).
 * Sempre recortado por companyId (RN-013) — quem restringe o que a
 * vendedora VÊ desses pedidos continua sendo o orderScope (RN-007).
 * `estourou` = havia mais clientes que o teto: a tela avisa para afinar a
 * busca, em vez de esconder pedido em silêncio.
 */
export async function clientesDaBusca(
  companyId: string,
  busca: Extract<BuscaDePedidos, { tipo: "telefone" | "nome" }>
): Promise<{ ids: string[]; estourou: boolean }> {
  if (busca.tipo === "telefone") {
    // as variantes do número, cada uma como "contém": digitar só o fim do
    // número (sem DDD) também acha — e telefone gravado formatado não escapa
    const variantes = new Set(phoneMatchVariants(busca.digitos));
    // sem DDD o phoneMatchVariants não alcança o 9º dígito — cobre aqui:
    // digitou "99999-1234" e o cadastro antigo é "9999-1234" (ou o inverso)
    const d = busca.digitos;
    if (d.length === 9 && d.startsWith("9")) variantes.add(d.slice(1));
    if (d.length === 8) variantes.add(`9${d}`);
    const padroes = [...variantes].map((v) => `%${v}%`);
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Customer"
      WHERE "companyId" = ${companyId}
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ANY (ARRAY[${Prisma.join(padroes)}])
      LIMIT ${TETO_CLIENTES + 1}`;
    return comTeto(rows.map((r) => r.id));
  }
  // nome: o acento é resolvido DENTRO do banco (translate), para não puxar
  // a base de clientes inteira a cada busca — loja madura tem dezenas de
  // milhares de cadastros. Vale para o nome da ficha, o do WhatsApp e a
  // razão social: são os nomes pelos quais a loja conhece a cliente.
  const alvo = `%${normalizarBusca(busca.texto)}%`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Customer"
    WHERE "companyId" = ${companyId}
      AND (
        translate(lower(name), ${COM_ACENTO}, ${SEM_ACENTO}) LIKE ${alvo}
        OR translate(lower(coalesce("waName", '')), ${COM_ACENTO}, ${SEM_ACENTO}) LIKE ${alvo}
        OR translate(lower(coalesce("legalName", '')), ${COM_ACENTO}, ${SEM_ACENTO}) LIKE ${alvo}
      )
    LIMIT ${TETO_CLIENTES + 1}`;
  return comTeto(rows.map((r) => r.id));
}
