import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  dadosDeEnvio,
  nomeParaDocumentos,
  mascararDocumento,
  criarTokenDadosEnvio,
  lerTokenDadosEnvio,
  VALIDADE_DO_LINK_MS,
} from "../dados-envio";

/**
 * FORMULÁRIO "DADOS DE ENVIO" (RN-024): a cliente preenche o próprio
 * cadastro pelo link do chat, e a razão social sai nos documentos enquanto a
 * ficha fica no nome de quem conversa.
 */

const ler = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => vi.useRealTimers());

const fichaCompleta = {
  zip: "01001-000", street: "Praça da Sé", streetNumber: "100",
  district: "Sé", city: "São Paulo", state: "SP",
  phone: "11999990000", cpf: "39053344705", cnpj: null,
};

describe("dadosDeEnvio — a régua única de cadastro completo", () => {
  it("ficha completa é completa", () => {
    expect(dadosDeEnvio(fichaCompleta)).toEqual({ completo: true, faltando: [] });
  });

  it("diz O QUE falta, com os nomes que a compra de etiqueta usa", () => {
    const r = dadosDeEnvio({ ...fichaCompleta, zip: " ", district: null, cpf: null });
    expect(r.completo).toBe(false);
    expect(r.faltando).toEqual(["CEP", "bairro", "CPF ou CNPJ"]);
  });

  it("CNPJ completo vale tanto quanto CPF", () => {
    expect(dadosDeEnvio({ ...fichaCompleta, cpf: null, cnpj: "11.222.333/0001-81" }).completo).toBe(true);
  });

  it("CEP de mentira não engana a régua (precisa dos 8 dígitos)", () => {
    // "s/n" preenchido dizia completo, e a cotação recusava depois
    expect(dadosDeEnvio({ ...fichaCompleta, zip: "s/n" }).faltando).toEqual(["CEP"]);
    expect(dadosDeEnvio({ ...fichaCompleta, zip: "1234-567" }).faltando).toEqual(["CEP"]);
  });

  it("telefone curto demais não conta (mesma régua da etiqueta)", () => {
    expect(dadosDeEnvio({ ...fichaCompleta, phone: "1199" }).faltando).toEqual(["telefone"]);
  });

  it("a compra de etiqueta usa ESTA régua (não uma cópia que diverge)", () => {
    const rota = ler("src/app/api/orders/[id]/frete/route.ts");
    expect(rota).toContain("dadosDeEnvio(c)");
  });
});

// Guarda RN-024 · Dados de envio pelo link: crachá sorteado com validade, a
// régua de completo é a da etiqueta, e a razão social sai nos documentos
// enquanto a ficha fica no nome de quem conversa
describe("nomeParaDocumentos — razão social onde documento manda", () => {
  const pj = { name: "Ju do Whats", cnpj: "11222333000181", legalName: "JU MODAS LTDA" };

  it("compra no CNPJ com razão social → razão social", () => {
    expect(nomeParaDocumentos(pj)).toBe("JU MODAS LTDA");
  });

  it("sem CNPJ, a razão social sobrando não engana o documento", () => {
    expect(nomeParaDocumentos({ ...pj, cnpj: null })).toBe("Ju do Whats");
  });

  it("CNPJ sem razão social cadastrada → o nome da ficha (melhor que nada)", () => {
    expect(nomeParaDocumentos({ ...pj, legalName: "  " })).toBe("Ju do Whats");
  });

  it("os TRÊS documentos usam a régua: etiqueta, NF-e e declaração", () => {
    expect(ler("src/app/api/orders/[id]/frete/route.ts")).toContain("nomeParaDocumentos(c)");
    expect(ler("src/lib/bling.ts")).toContain("nomeParaDocumentos(c)");
    expect(ler("src/app/declaracao/[id]/page.tsx")).toContain("nomeParaDocumentos(c)");
  });
});

describe("mascararDocumento — o link não entrega o documento", () => {
  it("CPF mostra só o meio", () => {
    expect(mascararDocumento("390.533.447-05")).toBe("***.533.447-**");
  });
  it("CNPJ mostra só o meio", () => {
    expect(mascararDocumento("11.222.333/0001-81")).toBe("**.222.333/****-**");
  });
  it("sem documento (ou torto) → null, nunca lixo", () => {
    expect(mascararDocumento(null)).toBeNull();
    expect(mascararDocumento("123")).toBeNull();
  });
});

describe("crachá do link — sorteado, com validade, e amarrado à loja", () => {
  it("vai e volta com cliente E loja", () => {
    const t = criarTokenDadosEnvio("cli-1", "loja-1");
    expect(lerTokenDadosEnvio(t)).toEqual({ customerId: "cli-1", companyId: "loja-1" });
  });

  it("nunca é o mesmo texto duas vezes", () => {
    expect(criarTokenDadosEnvio("cli-1", "loja-1")).not.toBe(criarTokenDadosEnvio("cli-1", "loja-1"));
  });

  it("adulterado é recusado", () => {
    const t = criarTokenDadosEnvio("cli-1", "loja-1");
    const [corpo, sig] = t.split(".");
    expect(lerTokenDadosEnvio(`${corpo}x.${sig}`)).toBeNull();
    expect(lerTokenDadosEnvio(`${corpo}.${"a".repeat(sig.length)}`)).toBeNull();
    expect(lerTokenDadosEnvio("")).toBeNull();
  });

  it("vence em 7 dias (o link ESCREVE na ficha — não pode valer para sempre)", () => {
    vi.useFakeTimers();
    const t = criarTokenDadosEnvio("cli-1", "loja-1");
    vi.advanceTimersByTime(VALIDADE_DO_LINK_MS - 1000);
    expect(lerTokenDadosEnvio(t)).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(lerTokenDadosEnvio(t)).toBeNull();
  });
});

describe("link curto — 11 caracteres no banco, e o antigo segue valendo", () => {
  it("as três portas usam o código curto (o crachá de 200+ caracteres assustava no WhatsApp)", () => {
    expect(ler("src/app/api/customers/[id]/dados-envio/route.ts")).toContain("criarLinkDadosEnvio");
    expect(ler("src/app/dados/[token]/page.tsx")).toContain("lerLinkDadosEnvio");
    expect(ler("src/app/api/dados-envio/route.ts")).toContain("lerLinkDadosEnvio");
  });

  it("o leitor aceita o crachá HMAC antigo — link já enviado no WhatsApp não pode quebrar", () => {
    const lib = ler("src/lib/dados-envio-link.ts");
    expect(lib).toContain('v.includes(".")');
    expect(lib).toContain("lerTokenDadosEnvio(v)");
  });

  it("o código é sorteado (64 bits — não se adivinha) e vence em 7 dias", () => {
    const lib = ler("src/lib/dados-envio-link.ts");
    expect(lib).toContain("randomBytes(8)");
    expect(lib).toContain("VALIDADE_DO_LINK_MS");
  });
});

describe("a razão social não se perde pelo caminho", () => {
  it("unificar contatos leva legalName, IE e waName junto (achado da revisão: o CNPJ ia e a razão ficava para trás)", () => {
    const lib = ler("src/lib/merge-contacts.ts");
    expect(lib).toContain('puxa("legalName")');
    expect(lib).toContain('puxa("stateRegistration")');
    expect(lib).toContain('puxa("waName")');
  });

  it("história importada não batiza a cliente com o nome da PRÓPRIA LOJA (pushName de mensagem fromMe)", () => {
    expect(ler("src/lib/comm/history-import.ts")).toContain("!r.key?.fromMe && r.pushName");
  });
});

describe("as portas da entrega", () => {
  it("o chat tem o botão e ele avisa quando a ficha já está completa", () => {
    const tela = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(tela).toContain("inserirLinkDados");
    expect(tela).toContain("já está COMPLETO");
  });

  it("a página pública fica fora do Google e mostra documento MASCARADO", () => {
    const pagina = ler("src/app/dados/[token]/page.tsx");
    expect(pagina).toContain("index: false");
    expect(pagina).toContain("mascararDocumento");
  });

  it("a rota pública troca o lado do documento inteiro (PF limpa PJ e vice-versa)", () => {
    const rota = ler("src/app/api/dados-envio/route.ts");
    expect(rota).toContain('cpf: d.tipo === "PF" ? cpf : null');
    expect(rota).toContain('cnpj: d.tipo === "PJ" ? cnpj : null');
    // e o telefone NÃO passa por ali (lição da RN-021)
    expect(rota).not.toContain("phone:");
  });

  it("o nome do WhatsApp chega sozinho (webhook) e é encontrável na busca", () => {
    const webhook = ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts");
    expect(webhook).toContain("waName: nomeNoWhats");
    // o OR explícito importa: `NOT` sozinho não casa com NULL no SQL, e todo
    // cadastro antigo nasce com o campo vazio (achado da revisão, provado no banco)
    expect(webhook).toContain("OR: [{ waName: null }, { NOT: { waName: nomeNoWhats } }]");
    expect(ler("src/lib/busca.ts")).toContain("casaTexto(cliente.waName, t)");
  });

  it("o NOME da ficha é do vendedor: o formulário só preenche crachá provisório", () => {
    const rota = ler("src/app/api/dados-envio/route.ts");
    expect(rota).toContain("nomeProvisorio(cliente.name) ? d.nome : cliente.name");
    expect(rota).toContain("name: nomeFinal");
    // e quando ela se apresenta diferente, a loja fica sabendo sem perder o
    // nome — comparando sem acento/maiúscula (alarme falso ensina a ignorar)
    expect(rota).toContain("ela se apresentou como");
    expect(rota).toContain("normalizarBusca(d.nome) !== normalizarBusca(cliente.name)");
    // a página não entrega o crachá provisório pré-preenchido (a cliente
    // pulava o campo e o telefone virava nome para sempre), e nome de gente
    // vem TRAVADO no formulário (editar sem efeito enganaria a cliente)
    const pagina = ler("src/app/dados/[token]/page.tsx");
    expect(pagina).toContain("!nomeProvisorio(cliente.name)");
    expect(pagina).toContain('nome: nomeDaLoja ? cliente.name : ""');
    expect(ler("src/app/dados/[token]/formulario.tsx")).toContain("nomeBloqueado ?");
  });

  it("razão social anda junto do CNPJ na edição (CNPJ apagado leva a razão junto)", () => {
    expect(ler("src/app/api/customers/[id]/route.ts")).toContain(
      "if (!cnpjFinal) data.legalName = null;"
    );
  });
});
