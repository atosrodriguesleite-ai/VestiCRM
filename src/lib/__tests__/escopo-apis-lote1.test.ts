import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Guarda RN-007, RN-013 (índice em docs/regras.md; texto no CLAUDE.md).

/**
 * LOTE 1 — "trancar as portas dos fundos" (auditoria 07/08/2026).
 *
 * Padrão que apareceu em vários módulos: a TELA esconde o botão por papel,
 * mas a API por trás só checa companyId — dava para uma vendedora chamar o
 * endereço direto e mexer no que não é dela. Cada rota abaixo passou a
 * aplicar o escopo/papel certo. Guardas de arquivo (a régra não pode voltar).
 */

const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("carteira do cliente só a gerência troca (PATCH ownerId)", () => {
  const rota = ler("src/app/api/customers/[id]/route.ts");
  it("troca de ownerId exige isManagerUp", () => {
    expect(rota).toContain("ownerId !== customer.ownerId");
    expect(rota).toContain("Só a gerência pode trocar a responsável");
    expect(rota).toContain("isManagerUp(user)");
  });
});

describe("funil e tarefas: vendedora só mexe no que é dela", () => {
  it("PATCH de oportunidade usa ownedScope", () => {
    const rota = ler("src/app/api/opportunities/[id]/route.ts");
    expect(rota).toContain("...ownedScope(user)");
    expect(rota).not.toContain("where: { id, companyId: user.companyId },\n    });\n    if (!opp)");
  });
  it("PATCH de tarefa usa taskScope", () => {
    expect(ler("src/app/api/tasks/[id]/route.ts")).toContain("...taskScope(user)");
  });
});

describe("conversas: escrita respeita o escopo da leitura", () => {
  it("enviar/editar/apagar/reenviar checam conversationScope", () => {
    expect(ler("src/app/api/conversations/[id]/messages/route.ts")).toContain(
      "conversationScope(user)"
    );
    expect(ler("src/app/api/messages/[id]/route.ts")).toContain("mensagemNoEscopo");
    expect(ler("src/app/api/messages/[id]/resend/route.ts")).toContain(
      "conversationScope(user)"
    );
  });
  it("transferir atendimento para OUTRA pessoa exige gerência", () => {
    const rota = ler("src/app/api/conversations/[id]/route.ts");
    expect(rota).toContain("...conversationScope(user)");
    expect(rota).toContain("Só a gerência pode transferir um atendimento");
  });
});

describe("campanhas: Suporte fora, cliente marcado é da loja", () => {
  const audience = ler("src/app/api/campaigns/[id]/audience/route.ts");
  it("GET e POST bloqueiam Suporte", () => {
    expect(audience.split("isSupport(user)").length).toBeGreaterThanOrEqual(3);
    expect(ler("src/app/api/campaigns/preview/route.ts")).toContain("isSupport(user)");
  });
  it("POST valida o tenant do customerId antes do upsert", () => {
    expect(audience).toContain("id: parsed.data.customerId, companyId: user.companyId");
  });
});

describe("track/identify deixa de ser oráculo de telefone", () => {
  const rota = ler("src/app/api/track/identify/route.ts");
  it("exige visitorId dono de sessão da loja e não devolve customerId", () => {
    expect(rota).toContain("trackSession.findFirst");
    expect(rota).toContain("linked: result.linked");
    expect(rota).not.toContain("return NextResponse.json(result)");
  });
});
