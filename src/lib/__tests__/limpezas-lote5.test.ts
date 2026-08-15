import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMentions } from "../notify";

// Guarda RN-006 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * LOTE 5 — PLATAFORMA E LIMPEZAS (auditoria 07/08/2026). Guardas das
 * correções: unificação sem perder dados, corrida do telefone fechada,
 * loja suspensa sem ingestão e os menores de WhatsApp/funil/clientes.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("unificar contatos não destrói dados", () => {
  const merge = ler("src/lib/merge-contacts.ts");
  it("a ficha do principal se completa com o que só o duplicado tinha", () => {
    expect(merge).toContain("A FICHA SE COMPLETA ANTES DE APAGAR");
    expect(merge).toContain('puxa("cpf")');
    expect(merge).toContain('puxa("birthDate")');
  });
  it("sacola abandonada e histórico de campanha são repontados, não apagados", () => {
    expect(merge).toContain("abandonedCart.updateMany");
    expect(merge).not.toContain("campaignSend.deleteMany({ where: { customerId: dupeId } })");
  });
  it("fusão de conversas trata mensagem repetida e herda dona/setor/não-lidas", () => {
    expect(merge).toContain("jaNoAlvo");
    expect(merge).toContain("notification.updateMany");
    expect(merge).toContain("unreadCount: extras.reduce");
  });
});

describe("corrida do telefone (incidente #0146) fechada no banco", () => {
  it("o intake trata P2002 re-buscando o cadastro do vencedor", () => {
    const intake = ler("src/lib/intake.ts");
    expect(intake).toContain('(e as { code?: string }).code === "P2002"');
    expect(intake).toContain("criadoPeloOutro");
  });
  it("a migração cria o índice único parcial SEM travar deploy com duplicados", () => {
    const mig = ler(
      "prisma/migrations/20260809150000_telefone_unico_por_loja/migration.sql"
    );
    expect(mig).toContain("Customer_companyId_phone_unico");
    expect(mig).toContain("RAISE NOTICE");
    expect(mig).toContain("WHERE phone <> ''");
  });
});

describe("loja suspensa não ingere pelas portas automáticas", () => {
  it("webhook Evolution, webhook antigo, intake e Nuvemshop respondem 200 mudo", () => {
    expect(ler("src/app/api/whatsapp/evolution/webhook/[token]/route.ts")).toContain(
      "loja?.suspended"
    );
    expect(ler("src/app/api/whatsapp/webhook/route.ts")).toContain("company.suspended");
    expect(ler("src/app/api/intake/[channel]/route.ts")).toContain("company.suspended");
    expect(ler("src/app/api/nuvemshop/webhook/route.ts")).toContain("suspended");
  });
  it("o cron da Jueri pula loja suspensa", () => {
    expect(ler("src/app/api/cron/jueri-sync/route.ts")).toContain(
      "company: { suspended: false }"
    );
  });
});

describe("pedidos: linha do tempo e venda com os dados CERTOS", () => {
  const rota = ler("src/app/api/orders/[id]/route.ts");
  it("evento de troca de vendedor/cliente só grava depois de salvar", () => {
    expect(rota).toContain("eventosPendentes");
  });
  it("status→PAGO na mesma chamada usa cliente/vendedor FINAIS", () => {
    expect(rota).toContain("clienteFinalId");
    expect(rota).toContain("sellerId: vendedorFinalId");
  });
  it("PDF de revenda não apaga a preferência salva da lojista", () => {
    const pdf = ler("src/app/api/orders/[id]/resale-pdf/route.ts");
    expect(pdf).toContain("Object.keys(lembrar).length > 0");
    expect(pdf).not.toContain("resaleStoreName: storeName || null");
  });
});

describe("clientes: dedup e limpeza respeitam o trabalho manual", () => {
  it("recadastrar telefone existente não rebaixa o tipo nem troca interesses", () => {
    const rota = ler("src/app/api/customers/route.ts");
    expect(rota).toContain('cadastroNovo || type !== "VAREJO"');
    expect(rota).toContain("skipDuplicates: true");
  });
  it("cliente nova pelo link da vendedora nasce na carteira DELA", () => {
    expect(ler("src/app/api/catalog/order/route.ts")).toContain(
      "...(linkSellerId ? { ownerId: linkSellerId } : {})"
    );
  });
  it("aniversário de 29/02 aparece em ano comum (28/02)", () => {
    expect(ler("src/lib/recompra.ts")).toContain("dia === 29");
  });
  it("ficha enriquecida à mão nunca é apagada como órfã", () => {
    expect(ler("src/lib/order-actions.ts")).toContain("enriquecido");
  });
});

describe("WhatsApp: menções, setores e importação", () => {
  it("e-mail não vira menção e primeiro nome repetido exige nome completo", () => {
    const time = [
      { id: "1", name: "Ana Souza" },
      { id: "2", name: "Ana Lima" },
      { id: "3", name: "Bruno Dias" },
    ];
    expect(parseMentions("mande para contato@Bruno hoje", time)).toEqual([]);
    expect(parseMentions("fala @Bruno!", time)).toEqual(["3"]);
    expect(parseMentions("@Ana pode ver?", time)).toEqual([]); // ambíguo: ninguém
    expect(parseMentions("@Ana Souza pode ver?", time)).toEqual(["1"]);
  });
  it("crachá do setor conta só conversa em andamento", () => {
    expect(ler("src/app/api/setores/route.ts")).toContain(
      'conversations: { where: { status: { not: "CLOSED" } } }'
    );
  });
  it("importação de histórico lembra o cliente por telefone (sem N+1)", () => {
    expect(ler("src/lib/comm/history-import.ts")).toContain("customerByPhone");
  });
  it("resposta rápida aceita {{nome}} e {nome}", () => {
    const inbox = ler("src/app/(app)/whatsapp/inbox.tsx");
    expect(inbox).toContain('replaceAll("{nome}"');
  });
});

describe("funil: automações certeiras", () => {
  it("avancarFunil não move o cartão de OUTRO pedido", () => {
    const f = ler("src/lib/funil-auto.ts");
    expect(f).toContain('status: "OPEN", order: null');
    expect(f).toContain("nomeCasaComEtapa");
  });
  it("a Regra 2 casa a etapa pelas variantes (não pelo nome exato)", () => {
    expect(ler("src/lib/automations.ts")).toContain(
      'nomeCasaComEtapa(s.name, "CATALOGO_ENVIADO")'
    );
  });
  it("contato feito só conclui tarefa automática DE CONTATO (lista fechada)", () => {
    const c = ler("src/lib/contato-feito.ts");
    expect(c).toContain('"reativar-perdido:"');
    expect(c).not.toContain("autoRule: { not: null }");
  });
});

describe("produção e exportações", () => {
  it("aproveitamento do corte trava em 100%", () => {
    expect(ler("src/lib/producao.ts")).toContain("Math.min(100, round2((pesoPecasKg / usedKg) * 100))");
  });
  it("costura baixa e credita numa transação só", () => {
    expect(ler("src/app/api/producao/costura/lancar/route.ts")).toContain("db.$transaction");
  });
  it("CSV da Inteligência neutraliza injeção de fórmula", () => {
    expect(ler("src/app/api/intelligence/export/route.ts")).toContain("^[=+\\-@\\t\\r]");
  });
});
