import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  barrasCode128C,
  modulosCode128C,
  PADROES_CODE128,
  simbolosCode128C,
} from "../nfe/code128";
import {
  chaveEmBlocos,
  documentoComMascara,
  lerNotaDoXml,
  numeroDaNota,
  serieDaNota,
  TETO_DO_XML,
} from "../nfe/xml-da-nota";
import {
  AVISO_DE_HOMOLOGACAO,
  camposDoDanfe,
  gerarDanfeSimplificado,
  lerFormatoDoDanfe,
  MENOR_LETRA_PT,
  MODULO_MM,
  TITULO_DO_DANFE,
} from "../nfe/danfe-simplificado";

// Guarda RN-111
//
// O DANFE SIMPLIFICADO – ETIQUETA SAI DO SISTEMA, E É UM RETRATO DO XML
// AUTORIZADO. Pedido do dono (16/11/2026): a etiqueta do Melhor Envio comprada
// com a chave da nota sai com "NF: 91", mas a página de impressão de lá não
// oferece o DANFE simplificado. O sistema passou a desenhá-lo, pela Nota
// Técnica 2020.004 (v1.10), com os dados do XML que a SEFAZ autorizou.
//
// O que estes testes prendem é o COMPORTAMENTO: a chave errada, a nota sem
// protocolo e o campo obrigatório em branco são RECUSADOS; o código de barras
// é o Code 128 C de verdade; e cada campo que a norma exige está no papel.

vi.mock("../db", () => ({
  db: {
    blingConnection: {
      findUnique: vi.fn().mockResolvedValue({
        companyId: "loja1",
        accessToken: "cripto",
        refreshToken: "cripto",
        expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
      }),
    },
  },
}));
vi.mock("../crypto", () => ({
  encryptSecret: (v: string) => v,
  decryptSecret: () => "token-de-mentira",
}));
vi.mock("../health", () => ({ logServerError: vi.fn() }));

import { abrirDocumentoDoBling, abrirXmlDaConsulta, baixarXmlDaNfe } from "../bling";

const CHAVE = "31261112345678000195550010000000931123456786";

/** Um nfeProc de mentira, no formato da SEFAZ (4.00). */
function xmlDaNota(mudar: (xml: string) => string = (x) => x): string {
  return mudar(
    `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe versao="4.00" Id="NFe${CHAVE}">
<ide><cUF>31</cUF><natOp>Venda</natOp><mod>55</mod><serie>1</serie><nNF>93</nNF>
<dhEmi>2026-11-14T10:22:31-03:00</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis></ide>
<emit><CNPJ>12345678000195</CNPJ><xNome>TOQUE LEVE CONFEC&#199;&#213;ES &amp; CIA LTDA</xNome>
<enderEmit><xLgr>Avenida Brasil</xLgr><nro>936</nro><xMun>Itabirinha</xMun><UF>MG</UF></enderEmit>
<IE>0012345670089</IE><IEST>999</IEST><CRT>1</CRT></emit>
<dest><CPF>12345678909</CPF><xNome>Shirleide de Lima</xNome>
<enderDest><xLgr>Rua dos Coqueirais</xLgr><xMun>Cotia</xMun><UF>SP</UF></enderDest>
<indIEDest>9</indIEDest></dest>
<det nItem="1"><prod><xProd>Regata</xProd></prod></det>
<total><ICMSTot><vProd>558.00</vProd><vNF>573.00</vNF></ICMSTot></total>
<transp><transporta><CNPJ>99999999000199</CNPJ><xNome>Transportadora X</xNome><UF>RJ</UF></transporta></transp>
</infNFe></NFe>
<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${CHAVE}</chNFe>
<dhRecbto>2026-11-14T10:22:40-03:00</dhRecbto><nProt>131260000123456</nProt>
<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>`
  );
}

function lida(mudar?: (xml: string) => string) {
  const r = lerNotaDoXml(xmlDaNota(mudar), CHAVE);
  if (!r.ok) throw new Error(`esperava ler a nota: ${r.motivo}`);
  return r.nota;
}

describe("código de barras da chave (Code 128 C)", () => {
  it("a tabela tem os 107 padrões, cada um com 11 módulos e a parada com 13, sem repetir", () => {
    expect(PADROES_CODE128).toHaveLength(107);
    const soma = (p: string) => [...p].reduce((a, d) => a + Number(d), 0);
    PADROES_CODE128.slice(0, 106).forEach((p) => {
      expect(p).toHaveLength(6);
      expect(soma(p)).toBe(11);
    });
    expect(soma(PADROES_CODE128[106])).toBe(13);
    expect(new Set(PADROES_CODE128).size).toBe(107);
  });

  it("escreve dois dígitos por símbolo, com início C, conferência e parada", () => {
    // exemplo clássico: "123456" no conjunto C → 105, 12, 34, 56, conferência 44, parada
    expect(simbolosCode128C("123456")).toEqual([105, 12, 34, 56, 44, 106]);
    const chave = simbolosCode128C(CHAVE);
    expect(chave).toHaveLength(1 + 22 + 1 + 1);
    expect(chave?.[0]).toBe(105);
    expect(chave?.at(-1)).toBe(106);
  });

  it("a chave de 44 dígitos ocupa 277 módulos e começa e termina em barra", () => {
    expect(modulosCode128C(CHAVE)).toBe(11 + 22 * 11 + 11 + 13);
    const barras = barrasCode128C(CHAVE);
    // número ÍMPAR de larguras: barra, espaço, …, barra
    expect((barras?.length ?? 0) % 2).toBe(1);
    // início C = 2-1-1-2-3-2
    expect(barras?.slice(0, 6)).toEqual([2, 1, 1, 2, 3, 2]);
    // parada = 2-3-3-1-1-1-2
    expect(barras?.slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it("o módulo fecha em pontos inteiros da impressora térmica e a chave cabe na etiqueta", () => {
    // 203 dpi = 8 pontos por milímetro: 0,25 mm são 2 pontos exatos
    expect(Number.isInteger(MODULO_MM * 8)).toBe(true);
    // 100 mm de etiqueta − 4 mm de margem de cada lado = 92 mm; o padrão pede
    // 10 módulos de margem clara de cada lado do código
    const comMargem = (modulosCode128C(CHAVE) + 20) * MODULO_MM;
    expect(comMargem).toBeLessThanOrEqual(92);
  });

  it("a chave de exemplo sai IGUAL, barra por barra, ao que outra biblioteca escreve", () => {
    // Gerado pela jsbarcode (CODE128C) para a mesma chave — 1 = módulo preto.
    // Somar 11 e não repetir não pega dois padrões trocados de lugar; isto pega.
    const esperado =
      "1101001110011011000110111001001101100010010010110011100100010110001110" +
      "0010110110000101001101100110011001101100101111010001110100011011011001" +
      "1001100100010011011001100110110011001101100110010100011110110001001001" +
      "1101101110101110110001000010110011110100100111011010001100011101011";
    const meu = (barrasCode128C(CHAVE) ?? [])
      .map((w, i) => (i % 2 === 0 ? "1" : "0").repeat(w))
      .join("");
    expect(meu).toBe(esperado);
  });

  it("recusa o que o conjunto C não escreve", () => {
    expect(barrasCode128C("123")).toBeNull();
    expect(barrasCode128C("12a4")).toBeNull();
    expect(barrasCode128C("")).toBeNull();
  });
});

describe("leitura do XML autorizado", () => {
  it("lê do XML tudo o que a norma manda imprimir", () => {
    const n = lida();
    expect(n.chave).toBe(CHAVE);
    expect(n.protocolo).toBe("131260000123456");
    expect(n.autorizadaEm).toBe("14/11/2026 10:22:40");
    expect(n.emitente).toEqual({
      nome: "TOQUE LEVE CONFECÇÕES & CIA LTDA",
      uf: "MG",
      documento: "12345678000195",
      // "IE" não é "IEST"
      ie: "0012345670089",
    });
    expect(n.tipoOperacao).toBe("SAIDA");
    expect(n.serie).toBe("1");
    expect(n.numero).toBe("93");
    expect(n.emitidaEm).toBe("14/11/2026");
    expect(n.destinatario).toEqual({
      nome: "Shirleide de Lima",
      uf: "SP",
      documento: "12345678909",
      tipoDocumento: "CPF",
      ie: null,
      contribuinte: false,
    });
    expect(n.valorTotal).toBe(573);
    expect(n.homologacao).toBe(false);
  });

  it("o nome e a UF são os do destinatário, nunca os da transportadora", () => {
    const n = lida();
    expect(n.destinatario.nome).not.toContain("Transportadora");
    expect(n.destinatario.uf).toBe("SP");
  });

  it("empresa com inscrição estadual sai como contribuinte, com a IE", () => {
    const n = lida((x) =>
      x
        .replace("<CPF>12345678909</CPF>", "<CNPJ>11222333000181</CNPJ>")
        .replace("<indIEDest>9</indIEDest>", "<indIEDest>1</indIEDest><IE>110042490114</IE>")
    );
    expect(n.destinatario.tipoDocumento).toBe("CNPJ");
    expect(n.destinatario.ie).toBe("110042490114");
    expect(n.destinatario.contribuinte).toBe(true);
  });

  it("nota de HOMOLOGAÇÃO é marcada (o papel diz sem valor fiscal)", () => {
    expect(lida().homologacao).toBe(false);
    expect(lida((x) => x.replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>")).homologacao).toBe(true);
    expect(
      lida((x) => x.replace("<cUF>31</cUF>", "<cUF>31</cUF><tpAmb>2</tpAmb>")).homologacao
    ).toBe(true);
  });

  it("a hora é a de quem emitiu: não converte fuso", () => {
    const n = lida((x) => x.replace("2026-11-14T10:22:40-03:00", "2026-11-14T23:59:59-04:00"));
    expect(n.autorizadaEm).toBe("14/11/2026 23:59:59");
  });

  it("XML de OUTRA nota é recusado, mesmo com tudo certo", () => {
    const outra = "3".repeat(44);
    const r = lerNotaDoXml(xmlDaNota(), outra);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("outra-nota");
    // e quando só o protocolo é de outra nota
    const r2 = lerNotaDoXml(
      xmlDaNota((x) => x.replace(`<chNFe>${CHAVE}</chNFe>`, `<chNFe>${outra}</chNFe>`)),
      CHAVE
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.motivo).toBe("outra-nota");
  });

  it("sem o protocolo da SEFAZ não há DANFE", () => {
    const r = lerNotaDoXml(
      xmlDaNota((x) => x.replace(/<protNFe[\s\S]*<\/protNFe>/, "")),
      CHAVE
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem-protocolo");
  });

  it("nota denegada ou rejeitada não vira DANFE", () => {
    for (const cStat of ["110", "301", "204", ""]) {
      const r = lerNotaDoXml(
        xmlDaNota((x) => x.replace("<cStat>100</cStat>", `<cStat>${cStat}</cStat>`)),
        CHAVE
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("nao-autorizada");
    }
    // autorizada fora do prazo (150) vale
    expect(
      lerNotaDoXml(xmlDaNota((x) => x.replace("<cStat>100</cStat>", "<cStat>150</cStat>")), CHAVE)
        .ok
    ).toBe(true);
  });

  it("contingência EPEC é recusada com o caminho (a norma pede o protocolo do evento)", () => {
    const r = lerNotaDoXml(
      xmlDaNota((x) => x.replace("<tpEmis>1</tpEmis>", "<tpEmis>4</tpEmis>")),
      CHAVE
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("contingencia-epec");
      expect(r.frase).toContain("DANFE completo");
    }
  });

  it("campo obrigatório em branco é recusa, dizendo QUAL — nunca um DANFE com buraco", () => {
    const casos: [(x: string) => string, string][] = [
      [(x) => x.replace("<IE>0012345670089</IE>", ""), "emitente: inscrição estadual"],
      [(x) => x.replace("<UF>MG</UF>", ""), "emitente: UF"],
      [(x) => x.replace("<serie>1</serie>", ""), "série"],
      [(x) => x.replace("<tpNF>1</tpNF>", ""), "tipo de operação"],
      [(x) => x.replace(/<dhEmi>[^<]*<\/dhEmi>/, ""), "data de emissão"],
      [(x) => x.replace("<CPF>12345678909</CPF>", ""), "destinatário: CNPJ/CPF"],
      [(x) => x.replace("<xNome>Shirleide de Lima</xNome>", ""), "destinatário: nome"],
      [(x) => x.replace("<UF>SP</UF>", ""), "destinatário: UF"],
    ];
    for (const [mudar, falta] of casos) {
      const r = lerNotaDoXml(xmlDaNota(mudar), CHAVE);
      expect(r.ok, falta).toBe(false);
      if (!r.ok) {
        expect(r.motivo).toBe("incompleta");
        expect(r.faltam).toContain(falta);
      }
    }
  });

  it("o que não é XML de NF-e, e o XML gigante, são recusados", () => {
    for (const lixo of ["", "<html><body>erro</body></html>", "x".repeat(TETO_DO_XML + 1)]) {
      const r = lerNotaDoXml(lixo, CHAVE);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toBe("nao-e-nfe");
    }
  });

  it("as máscaras do papel", () => {
    expect(chaveEmBlocos(CHAVE)).toBe(
      "3126 1112 3456 7800 0195 5500 1000 0000 9311 2345 6786"
    );
    expect(documentoComMascara("12345678000195")).toBe("12.345.678/0001-95");
    expect(documentoComMascara("12345678909")).toBe("123.456.789-09");
    expect(documentoComMascara("AB-1234")).toBe("AB-1234");
    expect(numeroDaNota("93")).toBe("000.000.093");
    expect(serieDaNota("1")).toBe("001");
  });
});

describe("o papel: campos obrigatórios da NT 2020.004", () => {
  it("o título é o que a norma manda", () => {
    expect(TITULO_DO_DANFE).toBe("DANFE SIMPLIFICADO - ETIQUETA");
    expect(MENOR_LETRA_PT).toBe(6);
  });

  it("chave, protocolo, emitente, dados da nota e destinatário estão no papel", () => {
    const c = camposDoDanfe(lida());
    expect(c.chave.valor.replace(/ /g, "")).toBe(CHAVE);
    expect(c.protocolo.valor).toBe("131260000123456 - 14/11/2026 10:22:40");
    expect(c.emitente.map((x) => x.titulo)).toEqual([
      "NOME/RAZÃO SOCIAL",
      "CNPJ",
      "INSCRIÇÃO ESTADUAL",
      "UF",
    ]);
    expect(c.emitente.map((x) => x.valor)).toEqual([
      "TOQUE LEVE CONFECÇÕES & CIA LTDA",
      "12.345.678/0001-95",
      "0012345670089",
      "MG",
    ]);
    expect(c.nota).toEqual([
      { titulo: "TIPO DE OPERAÇÃO", valor: "1 - SAÍDA" },
      { titulo: "SÉRIE", valor: "001" },
      { titulo: "NÚMERO", valor: "000.000.093" },
      { titulo: "DATA DE EMISSÃO", valor: "14/11/2026" },
    ]);
    expect(c.destinatario).toEqual([
      { titulo: "NOME/RAZÃO SOCIAL", valor: "Shirleide de Lima" },
      { titulo: "CPF", valor: "123.456.789-09" },
      { titulo: "UF", valor: "SP" },
    ]);
  });

  it("todo título está em caixa alta (norma, 02.3)", () => {
    const c = camposDoDanfe(lida());
    const titulos = [c.chave, c.protocolo, ...c.emitente, ...c.nota, ...c.destinatario].map(
      (x) => x.titulo
    );
    for (const t of titulos) expect(t).toBe(t.toUpperCase());
  });

  it("a inscrição estadual do destinatário aparece só quando existe", () => {
    const comIe = camposDoDanfe(
      lida((x) =>
        x
          .replace("<CPF>12345678909</CPF>", "<CNPJ>11222333000181</CNPJ>")
          .replace("<indIEDest>9</indIEDest>", "<indIEDest>1</indIEDest><IE>110042490114</IE>")
      )
    );
    expect(comIe.destinatario.map((x) => x.titulo)).toEqual([
      "NOME/RAZÃO SOCIAL",
      "CNPJ",
      "INSCRIÇÃO ESTADUAL",
      "UF",
    ]);
  });

  it("o valor total não vai para o papel (pode ser suprimido, § 15-A)", () => {
    const c = camposDoDanfe(lida());
    const linhas = [c.chave, c.protocolo, ...c.emitente, ...c.nota, ...c.destinatario];
    for (const l of linhas) {
      expect(l.titulo).not.toContain("TOTAL");
      expect(l.valor).not.toContain("573");
    }
  });

  it("o formato pedido torto cai no A4", () => {
    expect(lerFormatoDoDanfe("etiqueta")).toBe("etiqueta");
    expect(lerFormatoDoDanfe("a4")).toBe("a4");
    expect(lerFormatoDoDanfe("zebra")).toBe("a4");
    expect(lerFormatoDoDanfe(null)).toBe("a4");
  });

  it("gera o PDF nos dois tamanhos, e emoji no nome não derruba", async () => {
    const nota = lida((x) => x.replace("Shirleide de Lima", "Shirleide 💜 de Lima"));
    const mmEmPt = (v: number) => (v * 72) / 25.4;
    const etiqueta = await PDFDocument.load(await gerarDanfeSimplificado(nota, "etiqueta"));
    expect(etiqueta.getPageCount()).toBe(1);
    const tam = etiqueta.getPage(0).getSize();
    expect(tam.width).toBeCloseTo(mmEmPt(100), 1);
    expect(tam.height).toBeCloseTo(mmEmPt(150), 1);
    const a4 = await PDFDocument.load(await gerarDanfeSimplificado(nota, "a4"));
    expect(a4.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
  });

  it("nota de homologação também desenha (com o aviso de sem valor fiscal)", async () => {
    expect(AVISO_DE_HOMOLOGACAO).toContain("SEM VALOR FISCAL");
    const nota = lida((x) => x.replace("<tpAmb>1</tpAmb>", "<tpAmb>2</tpAmb>"));
    const normal = await gerarDanfeSimplificado(lida(), "etiqueta");
    const teste = await gerarDanfeSimplificado(nota, "etiqueta");
    // o aviso é texto a mais no papel
    expect(teste.byteLength).toBeGreaterThan(normal.byteLength);
  });

  it("nome enorme não derruba o desenho", async () => {
    const nota = lida((x) =>
      x.replace("Shirleide de Lima", "Confecções e Comércio de Roupas ".repeat(8).trim())
    );
    const pdf = await gerarDanfeSimplificado(nota, "etiqueta");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});

describe("o XML vem do Bling pela chave de acesso", () => {
  const fetchOriginal = globalThis.fetch;
  let chamadas: string[] = [];
  let resposta: () => Response;

  beforeEach(() => {
    chamadas = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      chamadas.push(String(url));
      return resposta();
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  const empacotar = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("abre o conteúdo GZIP + base64 da documentação — e recusa o que não é isso", () => {
    expect(abrirDocumentoDoBling(empacotar("<a>olá</a>"))).toBe("<a>olá</a>");
    // tolerância: base64 do próprio XML, sem GZIP
    expect(abrirDocumentoDoBling(Buffer.from("<a>b</a>").toString("base64"))).toBe("<a>b</a>");
    expect(abrirDocumentoDoBling("")).toBeNull();
    expect(abrirDocumentoDoBling(null)).toBeNull();
    expect(abrirDocumentoDoBling(Buffer.from("não é xml").toString("base64"))).toBeNull();
    // GZIP quebrado não estoura
    expect(abrirDocumentoDoBling(Buffer.from([0x1f, 0x8b, 1, 2, 3]).toString("base64"))).toBeNull();
  });

  it("chama a rota do documento NO ENDEREÇO DA API, com a chave e formato=xml", async () => {
    resposta = () => json({ data: [{ nome: "nota.xml", conteudo: empacotar(xmlDaNota()) }] });
    const r = await baixarXmlDaNfe("loja1", CHAVE);
    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      `https://api.bling.com.br/Api/v3/nfe/documento/${CHAVE}?formato=xml`,
    ]);
    if (r.ok) expect(lerNotaDoXml(r.xml, CHAVE).ok).toBe(true);
  });

  it("com mais de um documento, vale o que tem a nota COM o protocolo", async () => {
    const semProtocolo = xmlDaNota((x) => x.replace(/<protNFe[\s\S]*<\/protNFe>/, ""));
    resposta = () =>
      json({
        data: [
          { nome: "evento.xml", conteudo: empacotar("<procEventoNFe>carta</procEventoNFe>") },
          { nome: "sem.xml", conteudo: empacotar(semProtocolo) },
          { nome: "nota.xml", conteudo: empacotar(xmlDaNota()) },
        ],
      });
    const r = await baixarXmlDaNfe("loja1", CHAVE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.xml).toContain("protNFe");
  });

  it("chave torta nem chama o Bling; recusa do Bling vira frase", async () => {
    resposta = () => json({});
    expect((await baixarXmlDaNfe("loja1", "123")).ok).toBe(false);
    expect(chamadas).toEqual([]);

    resposta = () => json({ error: { type: "RESOURCE_NOT_FOUND", message: "Não achei" } }, 404);
    const r = await baixarXmlDaNfe("loja1", CHAVE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error.length).toBeGreaterThan(5);
    }

    resposta = () => json({ data: [] });
    expect((await baixarXmlDaNfe("loja1", CHAVE)).ok).toBe(false);
  });

  it("a segunda fonte só segue link https DO BLING, sem o token da loja, conferindo cada redirecionamento", async () => {
    const pedidos: { url: string; auth: string | null }[] = [];
    let responder: (u: string) => Response = () => new Response(xmlDaNota(), { status: 200 });
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      pedidos.push({ url: u, auth: new Headers(init?.headers).get("Authorization") });
      return responder(u);
    }) as unknown as typeof fetch;

    expect(await abrirXmlDaConsulta("https://www.bling.com.br/relatorios/nfe.xml.php?x=1")).toContain(
      "infNFe"
    );
    expect(pedidos).toHaveLength(1);
    // o token da loja nunca acompanha um link que veio de uma resposta
    expect(pedidos[0].auth).toBeNull();

    for (const ruim of [
      "http://www.bling.com.br/x.xml",
      "https://bling.com.br.golpe.com/x.xml",
      "https://golpe.com/bling.com.br/x.xml",
      "não é link",
      "",
    ]) {
      pedidos.length = 0;
      expect(await abrirXmlDaConsulta(ruim)).toBeNull();
      expect(pedidos).toHaveLength(0);
    }

    // redirecionamento DENTRO do Bling é seguido…
    pedidos.length = 0;
    responder = (u) =>
      u.includes("/relatorios/")
        ? new Response(null, { status: 302, headers: { Location: "https://arquivos.bling.com.br/n.xml" } })
        : new Response(xmlDaNota(), { status: 200 });
    expect(await abrirXmlDaConsulta("https://www.bling.com.br/relatorios/a")).toContain("protNFe");
    expect(pedidos.map((p) => p.url)).toEqual([
      "https://www.bling.com.br/relatorios/a",
      "https://arquivos.bling.com.br/n.xml",
    ]);

    // …e para FORA do Bling, não
    pedidos.length = 0;
    responder = () =>
      new Response(null, { status: 302, headers: { Location: "https://golpe.com/n.xml" } });
    expect(await abrirXmlDaConsulta("https://www.bling.com.br/relatorios/a")).toBeNull();
    expect(pedidos).toHaveLength(1);

    // corpo acima do teto é largado; o que não é NF-e também
    responder = () => new Response("x".repeat(4_000_001), { status: 200 });
    expect(await abrirXmlDaConsulta("https://www.bling.com.br/a")).toBeNull();
    responder = () => new Response("<html>erro</html>", { status: 200 });
    expect(await abrirXmlDaConsulta("https://www.bling.com.br/a")).toBeNull();

    // o campo já É o XML: nem sai para a rede
    pedidos.length = 0;
    expect(await abrirXmlDaConsulta(xmlDaNota())).toContain("protNFe");
    expect(pedidos).toHaveLength(0);
  });
});

describe("a tela", () => {
  const ler = (...partes: string[]) => readFileSync(join(process.cwd(), "src", ...partes), "utf8");

  it("o botão aparece na nota autorizada e na etiqueta comprada com a nota", () => {
    expect(ler("app", "(app)", "pedidos", "[id]", "cobranca-nfe.tsx")).toContain(
      "<DanfeSimplificado"
    );
    const envio = ler("app", "(app)", "pedidos", "[id]", "envio-frete.tsx");
    expect(envio).toContain("<DanfeSimplificado");
    // ao lado da etiqueta, a chave DELA vai junto (a porta confere as duas)
    expect(envio).toContain("chaveDaEtiqueta={ship.nfeKey}");
  });
});
