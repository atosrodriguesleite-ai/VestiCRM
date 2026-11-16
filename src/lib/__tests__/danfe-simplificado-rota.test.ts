import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import { NextRequest } from "next/server";

// A PORTA do DANFE simplificado (a regra é guardada em danfe-simplificado.test.ts), com o Bling de mentira:
// quem não vê o pedido não o imprime, só nota AUTORIZADA vira papel, XML de
// outra nota é recusado, e a recusa volta como PÁGINA em português (a porta
// abre numa aba — JSON cru não diria nada a quem clicou).

const CHAVE = "31261112345678000195550010000000931123456786";

const estado = vi.hoisted(() => ({
  user: { id: "u1", companyId: "loja1", role: "ADMIN", name: "Atos" } as {
    id: string;
    companyId: string;
    role: string;
    name: string;
  } | null,
  pedidos: [] as Record<string, unknown>[],
  buscas: [] as unknown[],
  logs: [] as { message: string; detail?: string | null; alarme?: false }[],
  gravacoes: [] as unknown[],
}));

vi.mock("@/lib/auth", () => {
  class AuthError extends Error {}
  return {
    AuthError,
    requireUser: async () => {
      if (!estado.user) throw new AuthError();
      return estado.user;
    },
  };
});
vi.mock("@/lib/db", () => ({
  db: {
    blingConnection: {
      findUnique: async () => ({
        companyId: "loja1",
        accessToken: "c",
        refreshToken: "c",
        expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000),
      }),
    },
    order: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        estado.buscas.push(args.where);
        return (
          estado.pedidos.find((p) =>
            Object.entries(args.where).every(([k, v]) => p[k] === v)
          ) ?? null
        );
      },
      updateMany: async (args: unknown) => {
        estado.gravacoes.push(args);
        return { count: 1 };
      },
    },
  },
}));
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (v: string) => v,
  decryptSecret: () => "token-de-mentira",
}));
vi.mock("@/lib/health", () => ({
  logServerError: async (i: { message: string; detail?: string | null; alarme?: false }) => {
    estado.logs.push(i);
  },
}));

import { GET } from "@/app/danfe-simplificado/[id]/route";

const xml = (chave = CHAVE, comProtocolo = true) =>
  `<nfeProc><NFe><infNFe versao="4.00" Id="NFe${chave}">
<ide><serie>1</serie><nNF>93</nNF><dhEmi>2026-11-14T10:22:31-03:00</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis></ide>
<emit><CNPJ>12345678000195</CNPJ><xNome>TOQUE LEVE LTDA</xNome><enderEmit><UF>MG</UF></enderEmit><IE>0012345670089</IE></emit>
<dest><CPF>12345678909</CPF><xNome>Shirleide de Lima</xNome><enderDest><UF>SP</UF></enderDest><indIEDest>9</indIEDest></dest>
</infNFe></NFe>${
    comProtocolo
      ? `<protNFe><infProt><chNFe>${chave}</chNFe><dhRecbto>2026-11-14T10:22:40-03:00</dhRecbto><nProt>131260000123456</nProt><cStat>100</cStat></infProt></protNFe>`
      : ""
  }</nfeProc>`;
const empacotar = (x: string) => gzipSync(Buffer.from(x, "utf8")).toString("base64");
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const pedir = (id = "p1", busca = "", headers?: Record<string, string>) =>
  GET(new NextRequest(`https://www.atacadopro.com/danfe-simplificado/${id}${busca}`, { headers }), {
    params: Promise.resolve({ id }),
  });

/** a consulta da nota no Bling: situação 5 = autorizada */
const consulta = (mudar: Record<string, unknown> = {}) =>
  json({ data: { situacao: 5, numero: "93", chaveAcesso: CHAVE, ...mudar } });
const documento = (x = xml()) => json({ data: [{ nome: "nota.xml", conteudo: empacotar(x) }] });
const ehConsulta = (u: string) => u.endsWith("/Api/v3/nfe/777");

describe("porta do DANFE simplificado", () => {
  const fetchOriginal = globalThis.fetch;
  let bling: (url: string) => Response;
  let chamadas: string[];
  const paraOBling = () => chamadas.filter((u) => u.includes("api.bling.com.br"));

  beforeEach(() => {
    estado.user = { id: "u1", companyId: "loja1", role: "ADMIN", name: "Atos" };
    estado.pedidos = [
      {
        id: "p1",
        companyId: "loja1",
        sellerId: "u2",
        nfeStatus: "AUTORIZADA",
        nfeKey: CHAVE,
        nfeBlingId: "777",
        nfeNumber: "93",
      },
    ];
    estado.buscas = [];
    estado.logs = [];
    estado.gravacoes = [];
    chamadas = [];
    bling = (u) => (ehConsulta(u) ? consulta() : documento());
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      chamadas.push(String(url));
      return bling(String(url));
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("nota autorizada vira PDF, sem cache, com o número no nome do arquivo", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Content-Disposition")).toContain("danfe-simplificado-nf-93.pdf");
    const corpo = Buffer.from(await res.arrayBuffer());
    expect(corpo.subarray(0, 5).toString()).toBe("%PDF-");
    // duas idas ao Bling: a situação de agora e o XML pela chave
    expect(paraOBling().sort()).toEqual(
      [
        "https://api.bling.com.br/Api/v3/nfe/777",
        `https://api.bling.com.br/Api/v3/nfe/documento/${CHAVE}?formato=xml`,
      ].sort()
    );
    expect(estado.logs).toEqual([]);
  });

  it("o pedido é procurado pela loja da SESSÃO — e a vendedora só acha o dela (RN-007)", async () => {
    await pedir();
    expect(estado.buscas[0]).toEqual({ id: "p1", companyId: "loja1" });
    const antes = chamadas.length;

    estado.user = { id: "u9", companyId: "loja1", role: "SELLER", name: "Bia" };
    const res = await pedir();
    expect(estado.buscas[1]).toEqual({ id: "p1", companyId: "loja1", sellerId: "u9" });
    expect(res.status).toBe(404);

    // outra loja não acha
    estado.user = { id: "x", companyId: "loja2", role: "ADMIN", name: "Outra" };
    expect((await pedir()).status).toBe(404);
    // nada foi ao Bling por quem não vê o pedido
    expect(chamadas.length).toBe(antes);
  });

  it("sem sessão: página dizendo para entrar de novo, e nada vai ao Bling", async () => {
    estado.user = null;
    const res = await pedir();
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("sessão venceu");
    expect(chamadas).toEqual([]);
  });

  it("nota que não está AUTORIZADA aqui (ou sem chave) não vira DANFE, e nem consulta o Bling", async () => {
    const base = estado.pedidos[0];
    for (const mudar of [
      { nfeStatus: "REJEITADA" },
      { nfeStatus: "EMITINDO" },
      { nfeStatus: "CANCELADA" },
      { nfeStatus: null },
      { nfeKey: null },
      { nfeKey: "123" },
      { nfeBlingId: null },
    ]) {
      estado.pedidos = [{ ...base, ...mudar }];
      const res = await pedir();
      expect(res.status, JSON.stringify(mudar)).toBe(409);
      expect(await res.text()).toContain("nota autorizada");
    }
    expect(chamadas).toEqual([]);
  });

  it("nota CANCELADA no Bling não vira DANFE, mesmo com o pedido dizendo autorizada — e o pedido é acertado", async () => {
    // o XML arquivado segue com o protocolo de autorização: é a consulta que barra
    bling = (u) => (ehConsulta(u) ? consulta({ situacao: 2 }) : documento());
    const res = await pedir();
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toContain("não está mais autorizada");
    expect(estado.gravacoes).toEqual([
      {
        where: { id: "p1", nfeBlingId: "777" },
        data: { nfeStatus: "CANCELADA", nfeKey: null },
      },
    ]);
  });

  it("situação desconhecida no Bling recusa, mas NÃO rebaixa o pedido", async () => {
    bling = (u) => (ehConsulta(u) ? consulta({ situacao: 1 }) : documento());
    expect((await pedir()).status).toBe(409);
    expect(estado.gravacoes).toEqual([]);
  });

  it("sem conseguir confirmar a situação no Bling, o DANFE não sai", async () => {
    bling = (u) => (ehConsulta(u) ? json({ error: { message: "fora" } }, 500) : documento());
    const res = await pedir();
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("confirmar");
    expect(estado.gravacoes).toEqual([]);
  });

  it("a chave do Bling diferente da gravada no pedido recusa (a nota mudou)", async () => {
    bling = (u) => (ehConsulta(u) ? consulta({ chaveAcesso: "4".repeat(44) }) : documento());
    const res = await pedir();
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("atualizar");
  });

  it("etiqueta comprada com OUTRA nota: recusa antes de ir ao Bling", async () => {
    const res = await pedir("p1", `?chave=${"5".repeat(44)}`);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("outra nota");
    expect(chamadas).toEqual([]);
    // com a chave certa, sai
    expect((await pedir("p1", `?chave=${CHAVE}`)).status).toBe(200);
  });

  it("XML de OUTRA nota é recusado (422), registrado sem alarme e sem dado da nota", async () => {
    bling = (u) => (ehConsulta(u) ? consulta() : documento(xml("3".repeat(44))));
    const res = await pedir();
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("outra nota");
    expect(estado.logs).toHaveLength(1);
    expect(estado.logs[0].alarme).toBe(false);
    const registrado = JSON.stringify(estado.logs[0]);
    expect(registrado).not.toContain("Shirleide");
    expect(registrado).not.toContain("12345678909");
  });

  it("recusa DECIDIDA (contingência EPEC) não vai ao painel de Saúde", async () => {
    bling = (u) =>
      ehConsulta(u)
        ? consulta()
        : documento(xml().replace("<tpEmis>1</tpEmis>", "<tpEmis>4</tpEmis>"));
    const res = await pedir();
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("DANFE completo");
    expect(estado.logs).toEqual([]);
  });

  it("XML sem protocolo na rota por chave: usa o XML que a MESMA consulta aponta, sem ida extra à API", async () => {
    bling = (u) => {
      if (ehConsulta(u))
        return consulta({ xml: "https://www.bling.com.br/relatorios/nfe.xml.php?x=1" });
      if (u.includes("/nfe/documento/")) return documento(xml(CHAVE, false));
      return new Response(xml(), { status: 200 });
    };
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(paraOBling()).toHaveLength(2);
    expect(chamadas).toHaveLength(3);

    // e se a segunda fonte também não tem: a recusa é a do protocolo, registrada
    bling = (u) => (ehConsulta(u) ? consulta() : documento(xml(CHAVE, false)));
    const res2 = await pedir();
    expect(res2.status).toBe(422);
    expect(await res2.text()).toContain("protocolo de autorização");
    expect(estado.logs.at(-1)?.message).toContain("sem-protocolo");
  });

  it("o XML pela chave falhou: página com a frase e o caminho do DANFE completo, registrada sem alarme", async () => {
    bling = (u) => (ehConsulta(u) ? consulta() : json({ error: { type: "X", message: "fora do ar" } }, 500));
    const res = await pedir();
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("ver DANFE");
    expect(estado.logs[0].alarme).toBe(false);
  });

  it("a frase do Bling não vira HTML na página de recusa", async () => {
    bling = (u) =>
      ehConsulta(u)
        ? consulta()
        : json({ error: { type: "X", message: "<script>alert(1)</script>", description: "<b>oi</b>" } }, 400);
    const texto = await (await pedir()).text();
    expect(texto).not.toContain("<script>alert(1)</script>");
    expect(texto).not.toContain("<b>oi</b>");
  });

  it("quem pede JSON (o botão do aplicativo instalado) recebe a FRASE da recusa em JSON", async () => {
    estado.pedidos = [{ ...estado.pedidos[0], nfeStatus: "REJEITADA" }];
    const res = await pedir("p1", "", { Accept: "application/pdf, application/json" });
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect((await res.json()).error).toContain("nota fiscal é autorizada");
    // o navegador comum (que aceita html) continua recebendo a página
    const html = await pedir("p1", "", { Accept: "text/html,application/json;q=0.9,*/*;q=0.8" });
    expect(html.headers.get("Content-Type")).toContain("text/html");
  });

  it("formato=etiqueta devolve a página de 10 × 15 cm", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const res = await pedir("p1", "?formato=etiqueta");
    const doc = await PDFDocument.load(await res.arrayBuffer());
    expect(doc.getPage(0).getSize().height).toBeCloseTo((150 * 72) / 25.4, 1);
  });

  it("a porta mora fora de /api: sem sessão o porteiro leva ao login, não devolve JSON", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(process.cwd(), "src/app/danfe-simplificado/[id]/route.ts"))).toBe(true);
    // e não está na lista de caminhos públicos do porteiro
    const porteiro = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(porteiro).not.toContain("danfe-simplificado");
  });
});
