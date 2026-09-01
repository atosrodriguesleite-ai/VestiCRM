/**
 * O LEITOR DE OFX (RN-037) — o arquivo que todo banco brasileiro exporta.
 *
 * Puro de propósito: ler o extrato não toca no banco de dados, então a regra
 * é testável linha a linha (e o arquivo de verdade de cada banco tem manias
 * próprias: tag sem fechar, acento em ISO-8859-1, data com fuso colado).
 *
 * O OFX vem em dois sabores e os dois entram aqui:
 *   • OFX 1.x, que é SGML — as tags NÃO fecham (`<FITID>123` e acabou);
 *   • OFX 2.x, que é XML — as tags fecham.
 * Ler o valor "até a próxima tag ou fim de linha" resolve os dois.
 */

export type MovimentoOFX = {
  /** o identificador que o BANCO dá ao movimento — é ele que evita duplicar */
  fitid: string;
  /** "2026-09-05" */
  dia: string;
  /** com sinal, como o banco manda: entrou positivo, saiu negativo */
  valor: number;
  descricao: string;
};

export type ExtratoOFX = {
  banco: string | null;
  conta: string | null;
  movimentos: MovimentoOFX[];
  /** movimentos que o arquivo trazia e não deu para ler — DITOS, nunca calados */
  descartados: number;
};

/** Pega o valor de uma tag, fechando ou não (SGML e XML no mesmo laço). */
function valorDaTag(bloco: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(bloco);
  return m ? m[1].trim() : null;
}

/**
 * "20260905120000[-3:BRT]" → "2026-09-05". O banco manda o fuso colado e
 * alguns mandam só a data; os 8 primeiros dígitos são a única parte que
 * TODOS mandam — e é a única de que precisamos (o dia é o que concilia).
 */
export function diaDoOFX(bruto: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(bruto.trim());
  if (!m) return null;
  const [, ano, mes, dia] = m;
  const n = Number(mes);
  const d = Number(dia);
  if (n < 1 || n > 12 || d < 1 || d > 31) return null;
  return `${ano}-${mes}-${dia}`;
}

/**
 * O valor do OFX. O padrão manda ponto decimal e nada de milhar, mas banco
 * brasileiro exporta de tudo — inclusive "1.200,50" e "1,200.50". Descartar
 * esses em silêncio é o pior desfecho: a lojista fecha a conferência com o
 * extrato divergindo e nunca sabe por quê.
 *
 * A regra é a posição: o ÚLTIMO separador é o decimal; o que vier antes é
 * separador de milhar e sai fora. Devolve null quando não é número.
 */
export function valorDoOFX(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\s/g, "");
  if (!/^[+-]?[\d.,]+$/.test(limpo) || !/\d/.test(limpo)) return null;
  const ultimoPonto = limpo.lastIndexOf(".");
  const ultimaVirgula = limpo.lastIndexOf(",");
  const corte = Math.max(ultimoPonto, ultimaVirgula);
  let normal: string;
  if (corte === -1) {
    normal = limpo;
  } else {
    const inteiro = limpo.slice(0, corte).replace(/[.,]/g, "");
    const decimal = limpo.slice(corte + 1);
    // separador com 3 dígitos depois e nenhum outro separador é MILHAR
    // ("1.200" é mil e duzentos, não um e vinte)
    normal =
      decimal.length === 3 && !/[.,]/.test(limpo.slice(0, corte))
        ? `${inteiro}${decimal}`
        : `${inteiro}.${decimal}`;
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Lê o extrato inteiro. Movimento sem FITID, sem data ou sem valor é
 * DESCARTADO: entrar sem identificador quebraria o "não duplica", e é
 * melhor a lojista ver 19 linhas de 20 do que 20 com uma inventada.
 */
export function lerOFX(texto: string): ExtratoOFX {
  const banco =
    valorDaTag(texto, "ORG") ??
    valorDaTag(texto, "BANKID") ??
    valorDaTag(texto, "FID");
  const conta = valorDaTag(texto, "ACCTID");

  const movimentos: MovimentoOFX[] = [];
  let descartados = 0;
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  for (const bruto of blocos) {
    const bloco = bruto.split(/<\/STMTTRN>/i)[0];
    const fitid = valorDaTag(bloco, "FITID");
    const dia = diaDoOFX(valorDaTag(bloco, "DTPOSTED") ?? "");
    const valor = valorDoOFX(valorDaTag(bloco, "TRNAMT") ?? "");
    if (!fitid || !dia || valor === null) {
      descartados += 1;
      continue;
    }
    // o nome útil está no MEMO em uns bancos e no NAME em outros; junta os
    // dois sem repetir, que é o que a lojista lê para reconhecer a linha
    const memo = valorDaTag(bloco, "MEMO") ?? "";
    const nome = valorDaTag(bloco, "NAME") ?? "";
    const descricao = [...new Set([nome.trim(), memo.trim()])]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
    movimentos.push({
      fitid: fitid.slice(0, 120),
      dia,
      valor,
      descricao: descricao || "Movimento sem descrição",
    });
  }
  return {
    banco: banco?.slice(0, 80) ?? null,
    conta: conta?.slice(0, 80) ?? null,
    movimentos,
    descartados,
  };
}

/**
 * O arquivo do banco quase nunca é UTF-8: o cabeçalho do OFX 1.x costuma
 * dizer `CHARSET:1252` (Windows) ou `ENCODING:USASCII`. Decodificar errado
 * transforma "Transferência" em "TransferÃªncia" na tela da lojista.
 */
export function decodificarOFX(bytes: ArrayBuffer): string {
  const cru = new TextDecoder("utf-8").decode(bytes);
  // quem decide é o CONTEÚDO, não o cabeçalho: banco que exporta UTF-8 com
  // `CHARSET:1252` escrito no topo existe, e confiar no cabeçalho produziria
  // justamente o "TransferÃªncia" que esta função evita. O caractere de
  // substituição (\uFFFD) é a prova de que o UTF-8 não deu conta.
  if (!cru.includes("\uFFFD")) return cru;
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return cru;
  }
}
