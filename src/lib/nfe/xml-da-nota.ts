/**
 * O QUE O DANFE SIMPLIFICADO PRECISA, LIDO DO XML DA NOTA (RN-111).
 *
 * O DANFE é um RETRATO da nota autorizada — não uma segunda versão dela. Por
 * isso os dados saem do XML que a SEFAZ autorizou (o Bling o entrega pela
 * chave de acesso), e NUNCA do cadastro daqui: a ficha da cliente pode ter
 * mudado depois da emissão, e um DANFE com o nome de hoje numa nota de ontem
 * seria um documento fiscal dizendo o que a nota não diz.
 *
 * Função pura. Três réguas:
 *
 * 1. A CHAVE DO XML TEM QUE SER A DO PEDIDO. O XML errado (de outra nota) com
 *    a chave certa por cima é o pior documento possível.
 * 2. SÓ NOTA AUTORIZADA, COM O PROTOCOLO. A norma (NT 2020.004) exige o
 *    Protocolo de Autorização de Uso impresso; XML sem ele não vira DANFE.
 * 3. CAMPO OBRIGATÓRIO QUE FALTA É RECUSA, dizendo qual — nunca um DANFE com
 *    um espaço em branco onde a norma manda ter dado.
 */

import { formatarCnpj, formatarCpf, soDigitos } from "@/lib/documento";

export type NotaParaDanfe = {
  chave: string;
  /** número do Protocolo de Autorização de Uso */
  protocolo: string;
  /** data e hora da autorização, como "14/11/2026 10:22:31" (hora de quem emitiu) */
  autorizadaEm: string | null;
  emitente: { nome: string; uf: string; documento: string; ie: string };
  tipoOperacao: "ENTRADA" | "SAIDA";
  serie: string;
  numero: string;
  /** data da emissão, "14/11/2026" */
  emitidaEm: string;
  destinatario: {
    nome: string;
    uf: string;
    /** CNPJ, CPF (só dígitos) ou o documento de estrangeiro */
    documento: string;
    tipoDocumento: "CNPJ" | "CPF" | "ESTRANGEIRO";
    /** "quando existir" (NT 2020.004, 02.4 d) */
    ie: string | null;
    /** contribuinte do ICMS (indIEDest = 1): a tela avisa, ver RN-111 */
    contribuinte: boolean;
  };
  valorTotal: number | null;
  /** emitida em ambiente de HOMOLOGAÇÃO (tpAmb = 2): o papel diz "sem valor fiscal" */
  homologacao: boolean;
};

export type LeituraDaNota =
  | { ok: true; nota: NotaParaDanfe }
  | {
      ok: false;
      motivo:
        | "nao-e-nfe"
        | "outra-nota"
        | "sem-protocolo"
        | "nao-autorizada"
        | "contingencia-epec"
        | "incompleta";
      /** frase em português, pronta para a tela */
      frase: string;
      /** nomes dos campos que faltaram (sem dado nenhum da nota) */
      faltam?: string[];
    };

/** teto do XML: uma NF-e de pedido grande tem dezenas de KB, nunca megabytes */
export const TETO_DO_XML = 4_000_000;

/**
 * O miolo da PRIMEIRA ocorrência da tag (com ou sem prefixo de espaço de
 * nomes). O nome é conferido inteiro: "IE" não casa com "IEST", "ide" não
 * casa com "idEstrangeiro".
 */
function bloco(xml: string, tag: string): string | null {
  const abre = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?=[\\s>/])[^>]*?(/?)>`);
  const m = abre.exec(xml);
  if (!m) return null;
  if (m[1] === "/") return "";
  const comeco = m.index + m[0].length;
  const fecha = new RegExp(`</(?:[A-Za-z0-9_]+:)?${tag}\\s*>`);
  const f = fecha.exec(xml.slice(comeco));
  if (!f) return null;
  return xml.slice(comeco, comeco + f.index);
}

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (tudo, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // fora do alcance de um caractere de verdade: fica como veio
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tudo;
    }
    return ENTIDADES[e] ?? tudo;
  });
}

/** O texto de um campo simples dentro do bloco (sem tags por dentro). */
function campo(dentro: string | null, tag: string): string {
  if (dentro == null) return "";
  const miolo = bloco(dentro, tag);
  if (miolo == null || miolo.includes("<")) return "";
  return decodificar(miolo).replace(/\s+/g, " ").trim();
}


/** "2026-11-14T10:22:31-03:00" → { dia: "14/11/2026", hora: "10:22:31" } — a hora de quem emitiu, sem converter fuso. */
function dataDoXml(valor: string): { dia: string; hora: string | null } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(valor);
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return {
    dia: `${m[3]}/${m[2]}/${m[1]}`,
    hora: m[4] ? `${m[4]}:${m[5]}:${m[6] ?? "00"}` : null,
  };
}

/** situações da SEFAZ que são "autorizado o uso da NF-e" (no prazo e fora dele) */
const AUTORIZADA = new Set(["100", "150"]);

/**
 * Lê do XML autorizado o que o DANFE Simplificado – Etiqueta imprime.
 * `chaveEsperada` é a chave gravada no pedido.
 */
export function lerNotaDoXml(xml: string, chaveEsperada: string): LeituraDaNota {
  const naoE = {
    ok: false as const,
    motivo: "nao-e-nfe" as const,
    frase: "O arquivo que o Bling devolveu não é o XML de uma NF-e.",
  };
  if (typeof xml !== "string" || xml.length === 0 || xml.length > TETO_DO_XML) return naoE;

  // a chave mora no atributo Id="NFe<44 dígitos>" do infNFe
  const idNota = /<(?:[A-Za-z0-9_]+:)?infNFe(?=[\s>])[^>]*\bId\s*=\s*["']NFe(\d{44})["']/.exec(xml);
  const inf = bloco(xml, "infNFe");
  if (!idNota || inf == null) return naoE;
  const outra = {
    ok: false as const,
    motivo: "outra-nota" as const,
    frase:
      "O XML que o Bling devolveu é de outra nota (a chave de acesso não é a deste pedido). Atualize a situação da nota e tente de novo.",
  };
  if (idNota[1] !== chaveEsperada) return outra;

  // o protocolo vem FORA do infNFe, no protNFe que a SEFAZ devolve
  const prot = bloco(bloco(xml, "protNFe") ?? "", "infProt");
  const protocolo = soDigitos(campo(prot, "nProt"));
  if (prot == null || !protocolo)
    return {
      ok: false,
      motivo: "sem-protocolo",
      frase:
        "O XML que o Bling devolveu ainda não traz o protocolo de autorização da SEFAZ. Sem ele o DANFE simplificado não pode ser impresso — atualize a situação da nota e tente em instantes.",
    };
  const chaveDoProtocolo = soDigitos(campo(prot, "chNFe"));
  if (chaveDoProtocolo && chaveDoProtocolo !== chaveEsperada) return outra;
  if (!AUTORIZADA.has(campo(prot, "cStat")))
    return {
      ok: false,
      motivo: "nao-autorizada",
      frase:
        "A SEFAZ não autorizou esta nota (ou ela foi denegada). O DANFE simplificado só existe para nota autorizada.",
    };

  const ide = bloco(inf, "ide");
  // contingência EPEC: a norma manda imprimir o protocolo do EVENTO, que este
  // XML não traz — melhor recusar do que imprimir o protocolo errado
  if (campo(ide, "tpEmis") === "4")
    return {
      ok: false,
      motivo: "contingencia-epec",
      frase:
        "Esta nota foi emitida em contingência (EPEC). Para ela, use o DANFE completo (botão “ver DANFE”).",
    };

  const emit = bloco(inf, "emit");
  const dest = bloco(inf, "dest");
  const faltam: string[] = [];
  const exigir = (valor: string, nome: string) => {
    if (!valor) faltam.push(nome);
    return valor;
  };

  const emitente = {
    nome: exigir(campo(emit, "xNome"), "emitente: nome"),
    uf: exigir(campo(bloco(emit ?? "", "enderEmit"), "UF"), "emitente: UF"),
    documento: exigir(
      soDigitos(campo(emit, "CNPJ")) || soDigitos(campo(emit, "CPF")),
      "emitente: CNPJ"
    ),
    ie: exigir(campo(emit, "IE"), "emitente: inscrição estadual"),
  };

  const tpNF = campo(ide, "tpNF");
  if (tpNF !== "0" && tpNF !== "1") faltam.push("tipo de operação");
  const serie = exigir(soDigitos(campo(ide, "serie")), "série");
  const numero = exigir(soDigitos(campo(ide, "nNF")), "número");
  const emissao = dataDoXml(campo(ide, "dhEmi") || campo(ide, "dEmi"));
  if (!emissao) faltam.push("data de emissão");

  const cnpj = soDigitos(campo(dest, "CNPJ"));
  const cpf = soDigitos(campo(dest, "CPF"));
  const estrangeiro = campo(dest, "idEstrangeiro");
  const temEstrangeiro = dest != null && bloco(dest, "idEstrangeiro") != null;
  const documento = cnpj || cpf || estrangeiro;
  // estrangeiro pode vir com o documento em branco (a tag existe, vazia)
  if (!documento && !temEstrangeiro) faltam.push("destinatário: CNPJ/CPF");
  const destinatario = {
    nome: exigir(campo(dest, "xNome"), "destinatário: nome"),
    uf: exigir(campo(bloco(dest ?? "", "enderDest"), "UF"), "destinatário: UF"),
    documento,
    tipoDocumento: (cnpj ? "CNPJ" : cpf ? "CPF" : "ESTRANGEIRO") as
      | "CNPJ"
      | "CPF"
      | "ESTRANGEIRO",
    ie: campo(dest, "IE") || null,
    contribuinte: campo(dest, "indIEDest") === "1",
  };

  if (faltam.length > 0 || !emissao)
    return {
      ok: false,
      motivo: "incompleta",
      frase: `O XML da nota veio sem dado que o DANFE simplificado é obrigado a mostrar (${faltam.join(", ")}). Use o DANFE completo (botão “ver DANFE”).`,
      faltam,
    };

  const autorizacao = dataDoXml(campo(prot, "dhRecbto"));
  const vNF = Number(campo(bloco(bloco(inf, "total") ?? "", "ICMSTot"), "vNF"));
  return {
    ok: true,
    nota: {
      chave: chaveEsperada,
      protocolo,
      autorizadaEm: autorizacao
        ? autorizacao.hora
          ? `${autorizacao.dia} ${autorizacao.hora}`
          : autorizacao.dia
        : null,
      emitente,
      tipoOperacao: tpNF === "0" ? "ENTRADA" : "SAIDA",
      serie,
      numero,
      emitidaEm: emissao.dia,
      destinatario,
      valorTotal: Number.isFinite(vNF) && vNF > 0 ? vNF : null,
      homologacao: campo(ide, "tpAmb") === "2" || campo(prot, "tpAmb") === "2",
    },
  };
}

/** A chave em blocos de 4, como o DANFE a escreve. */
export function chaveEmBlocos(chave: string): string {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** CNPJ/CPF com a máscara da casa; o que não for nem um nem outro sai como veio. */
export function documentoComMascara(doc: string): string {
  if (/^\d{14}$/.test(doc)) return formatarCnpj(doc);
  if (/^\d{11}$/.test(doc)) return formatarCpf(doc);
  return doc;
}

/** "93" → "000.000.093" */
export function numeroDaNota(numero: string): string {
  return numero.padStart(9, "0").replace(/^(\d{3})(\d{3})(\d{3})$/, "$1.$2.$3");
}

/** "1" → "001" */
export function serieDaNota(serie: string): string {
  return serie.padStart(3, "0");
}
