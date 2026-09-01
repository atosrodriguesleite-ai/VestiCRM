// Guarda RN-037
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodificarOFX, diaDoOFX, lerOFX, valorDoOFX } from "../financeiro/ofx";
import { casamentosObvios } from "../financeiro/conciliacao";

/**
 * RN-037 · Conciliação bancária: o extrato do banco entra por OFX, o FITID
 * impede duplicar, o casamento óbvio é automático (e só quando a resposta é
 * única), um depósito pode pagar várias parcelas e os dois lados têm que
 * somar igual. Conciliar carimba "conferido" — nunca mexe em dinheiro.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** OFX 1.x — SGML, as tags NÃO fecham (é assim que o banco brasileiro manda). */
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>Banco do Brasil<FID>001</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>001<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260905120000[-3:BRT]
<TRNAMT>530.00
<FITID>2026090500001
<NAME>PIX RECEBIDO
<MEMO>ANA PAULA SOUZA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260906
<TRNAMT>-1200.50
<FITID>2026090600002
<MEMO>TED MALHARIA SUL
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260907
<TRNAMT>-9.90
<FITID>2026090700003
<MEMO>TARIFA PACOTE DE SERVICOS
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

/** OFX 2.x — XML de verdade, com as tags fechando. */
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><ACCTID>99887-1</ACCTID></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN>
        <TRNTYPE>CREDIT</TRNTYPE>
        <DTPOSTED>20260910100000</DTPOSTED>
        <TRNAMT>250.00</TRNAMT>
        <FITID>XY-1</FITID>
        <MEMO>DEPOSITO</MEMO>
      </STMTTRN>
    </BANKTRANLIST>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("ler o arquivo do banco (RN-037)", () => {
  it("lê o OFX 1.x (SGML, tag que não fecha) — o formato do banco brasileiro", () => {
    const e = lerOFX(OFX_SGML);
    expect(e.movimentos).toHaveLength(3);
    expect(e.banco).toBe("Banco do Brasil");
    expect(e.conta).toBe("12345-6");
  });

  it("lê o OFX 2.x (XML) pelo mesmo caminho", () => {
    const e = lerOFX(OFX_XML);
    expect(e.movimentos).toHaveLength(1);
    expect(e.movimentos[0]).toMatchObject({ fitid: "XY-1", dia: "2026-09-10", valor: 250 });
  });

  it("o sinal vem do banco: entrada positiva, saída negativa", () => {
    const [pix, ted, tarifa] = lerOFX(OFX_SGML).movimentos;
    expect(pix.valor).toBe(530);
    expect(ted.valor).toBe(-1200.5);
    expect(tarifa.valor).toBe(-9.9);
  });

  it("junta NAME e MEMO para a lojista reconhecer a linha", () => {
    const [pix] = lerOFX(OFX_SGML).movimentos;
    expect(pix.descricao).toContain("PIX RECEBIDO");
    expect(pix.descricao).toContain("ANA PAULA SOUZA");
  });

  it("a data ignora o fuso colado pelo banco", () => {
    expect(diaDoOFX("20260905120000[-3:BRT]")).toBe("2026-09-05");
    expect(diaDoOFX("20260906")).toBe("2026-09-06");
    expect(diaDoOFX("nada disso")).toBeNull();
    expect(diaDoOFX("20261305")).toBeNull(); // mês 13 não existe
  });

  it("o valor aceita os jeitos que os bancos exportam de verdade", () => {
    expect(valorDoOFX("530.00")).toBe(530);
    expect(valorDoOFX("1234,56")).toBe(1234.56);
    expect(valorDoOFX("-42")).toBe(-42);
    // com separador de MILHAR: descartar em silêncio faria a lojista fechar
    // a conferência com o extrato divergindo
    expect(valorDoOFX("1.200,50")).toBe(1200.5);
    expect(valorDoOFX("-1,200.50")).toBe(-1200.5);
    expect(valorDoOFX("1.200")).toBe(1200); // três casas e nada mais: milhar
    expect(valorDoOFX("1.20")).toBe(1.2); // duas casas: decimal
    expect(valorDoOFX("")).toBeNull();
    expect(valorDoOFX("R$ 10,00")).toBeNull();
  });

  it("linha ilegível é CONTADA, para a tela poder avisar", () => {
    const torto = `<STMTTRN><FITID>A1<TRNAMT>10.00</STMTTRN>
<STMTTRN><FITID>A3<DTPOSTED>20260905<TRNAMT>10.00</STMTTRN>`;
    const e = lerOFX(torto);
    expect(e.movimentos).toHaveLength(1);
    expect(e.descartados).toBe(1);
  });

  it("quem decide o acento é o CONTEÚDO, não o cabeçalho do arquivo", () => {
    // banco que exporta UTF-8 com "CHARSET:1252" no topo existe; confiar no
    // cabeçalho produziria justamente o "TransferÃªncia"
    const utf8 = new TextEncoder().encode("CHARSET:1252\n<MEMO>Transferência");
    expect(decodificarOFX(utf8.buffer as ArrayBuffer)).toContain("Transferência");
    // e o arquivo REALMENTE em windows-1252 é lido certo
    const latin = new Uint8Array([0x54, 0x72, 0x61, 0x6e, 0x73, 0x66, 0x65, 0x72, 0xea, 0x6e, 0x63, 0x69, 0x61]);
    expect(decodificarOFX(latin.buffer as ArrayBuffer)).toBe("Transferência");
  });

  it("movimento sem FITID, sem data ou sem valor é DESCARTADO", () => {
    // entrar sem identificador quebraria o "não duplica" — melhor 19 linhas
    // certas do que 20 com uma inventada
    const torto = `<OFX><BANKTRANLIST>
<STMTTRN><DTPOSTED>20260905<TRNAMT>10.00</STMTTRN>
<STMTTRN><FITID>A1<TRNAMT>10.00</STMTTRN>
<STMTTRN><FITID>A2<DTPOSTED>20260905</STMTTRN>
<STMTTRN><FITID>A3<DTPOSTED>20260905<TRNAMT>10.00</STMTTRN>
</BANKTRANLIST></OFX>`;
    const e = lerOFX(torto);
    expect(e.movimentos).toHaveLength(1);
    expect(e.movimentos[0].fitid).toBe("A3");
  });

  it("arquivo que não é OFX não vira movimento nenhum", () => {
    expect(lerOFX("isto aqui é um PDF, não um extrato").movimentos).toEqual([]);
    expect(lerOFX("").movimentos).toEqual([]);
  });

  it("linha sem descrição ganha um texto, nunca fica em branco na tela", () => {
    const e = lerOFX(`<STMTTRN><FITID>Z9<DTPOSTED>20260905<TRNAMT>1.00</STMTTRN>`);
    expect(e.movimentos[0].descricao).toBe("Movimento sem descrição");
  });
});

describe("as regras da conciliação (RN-037)", () => {
  const motor = ler("src/lib/financeiro/conciliacao.ts");

  it("quem diz que é o mesmo movimento é o BANCO (fitid único por conta)", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).toContain("@@unique([companyId, contaId, fitid])");
    // e reimportar o mesmo arquivo não explode: pula o que já está aqui
    expect(motor).toContain("skipDuplicates: true");
  });

  it("a mesma baixa não se concilia duas vezes", () => {
    const schema = ler("prisma/schema.prisma");
    expect(schema).toContain("@@unique([companyId, baixaId])");
    expect(motor).toContain("vinculoOfx: { is: null }");
  });

  it("o casamento automático olha os DOIS lados (regra, não texto do código)", () => {
    const linha = (id: string, dia: string, valor: number) => ({ id, dia, valor });

    // par óbvio: casa
    expect(
      casamentosObvios([linha("L1", "2026-09-05", 530)], [linha("B1", "2026-09-05", 530)])
    ).toEqual([{ linhaId: "L1", baixaId: "B1" }]);

    // a data pode andar dentro da janela (o banco lança no dia seguinte)
    expect(
      casamentosObvios([linha("L1", "2026-09-05", 530)], [linha("B1", "2026-09-07", 530)])
    ).toHaveLength(1);
    // fora da janela, não
    expect(
      casamentosObvios([linha("L1", "2026-09-05", 530)], [linha("B1", "2026-09-20", 530)])
    ).toEqual([]);

    // o SINAL importa: saída do banco não casa com entrada da loja
    expect(
      casamentosObvios([linha("L1", "2026-09-05", -530)], [linha("B1", "2026-09-05", 530)])
    ).toEqual([]);

    // DUAS baixas iguais para uma linha: não vira palpite
    expect(
      casamentosObvios(
        [linha("L1", "2026-09-05", 300)],
        [linha("B1", "2026-09-05", 300), linha("B2", "2026-09-05", 300)]
      )
    ).toEqual([]);

    // e do outro lado também: duas linhas iguais para uma baixa só
    expect(
      casamentosObvios(
        [linha("L1", "2026-09-05", 300), linha("L2", "2026-09-05", 300)],
        [linha("B1", "2026-09-05", 300)]
      )
    ).toEqual([]);

    // vários pares independentes casam todos
    expect(
      casamentosObvios(
        [linha("L1", "2026-09-05", 530), linha("L2", "2026-09-06", -1200.5)],
        [linha("B1", "2026-09-05", 530), linha("B2", "2026-09-06", -1200.5)]
      )
    ).toEqual([
      { linhaId: "L1", baixaId: "B1" },
      { linhaId: "L2", baixaId: "B2" },
    ]);

    // centavo diferente é outra coisa — e é justamente o erro a achar
    expect(
      casamentosObvios([linha("L1", "2026-09-05", 530)], [linha("B1", "2026-09-05", 530.01)])
    ).toEqual([]);
  });

  it("o casamento não fica preso ao arquivo que acabou de entrar", () => {
    // linha que ficou para trás por falta de par casa quando o lançamento
    // aparece — e subir o mesmo arquivo de novo continua conciliando
    expect(motor).toContain("vinculos: { none: {} }");
    expect(motor).not.toContain("importacaoId,\n      ignoradaEm");
  });

  it("baixa ESTORNADA solta a conciliação — nas duas portas de estorno", () => {
    // linha "conferida" contra dinheiro que voltou atrás faria a conferência
    // do mês fechar com um erro impossível de achar
    expect(motor).toContain("export async function soltarConciliacaoDaBaixa");
    expect(ler("src/app/api/financeiro/baixas/[id]/route.ts")).toContain(
      "soltarConciliacaoDaBaixa"
    );
    expect(ler("src/lib/financeiro/porta-vendas.ts")).toContain(
      "soltarConciliacaoDaBaixa"
    );
  });

  it("os cards contam o PERÍODO INTEIRO, nunca as linhas exibidas (RN-030)", () => {
    expect(motor).toContain("db.finBaixa.count(");
    expect(motor).not.toContain("semExtrato: baixas.length");
  });

  it("um depósito pode pagar VÁRIAS parcelas, e a soma tem que bater", () => {
    expect(motor).toContain("Math.abs(soma - linha.valor) >= 0.005");
    expect(motor).toContain("Os dois lados não batem");
  });

  it("conciliar NÃO mexe em dinheiro: só carimba conferido", () => {
    // nenhuma escrita em baixa, parcela ou lançamento mora aqui
    expect(motor).not.toMatch(/db\.finBaixa\.(create|update|delete)/);
    expect(motor).not.toMatch(/db\.finParcela\.(create|update|delete)/);
    expect(motor).not.toMatch(/db\.finLancamento\.(create|update|delete)/);
  });

  it("estornada não se concilia (o dinheiro voltou atrás)", () => {
    expect(motor).toContain("Lançamento estornado não se concilia");
  });

  it("a conciliação é conta a conta — extrato de um banco não casa com outro", () => {
    expect(motor).toContain("contaId: linha.contaId");
    expect(motor).toContain("a conciliação é conta a conta");
  });

  it("as portas são gated como todas as do módulo (RN-029)", () => {
    for (const p of [
      "src/app/api/financeiro/conciliacao/importar/route.ts",
      "src/app/api/financeiro/conciliacao/[linhaId]/route.ts",
      "src/app/(app)/financeiro/conciliacao/page.tsx",
    ]) {
      expect(ler(p)).toMatch(/porteiraFinanceiro|financeiroLiberado/);
    }
  });

  it("o arquivo do banco NÃO é guardado (dívida técnica nº 1)", () => {
    const rota = ler("src/app/api/financeiro/conciliacao/importar/route.ts");
    expect(rota).toContain("O arquivo NÃO é guardado");
    expect(rota).toContain("TETO_BYTES");
    const schema = ler("prisma/schema.prisma");
    expect(schema).not.toContain("model FinOfxArquivo");
  });
});
