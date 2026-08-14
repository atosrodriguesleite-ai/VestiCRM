import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  statusDoRastreio,
  statusDoPedidoPeloRastreio,
  novoCodigoPublico,
  linkDoRastreio,
} from "../rastreio";

/**
 * O PEDIDO ANDA SOZINHO (14/08/2026) — postou vira "Enviado", chegou vira
 * "Entregue", e a cliente acompanha por um link. O E2E completo roda contra o
 * Postgres local; aqui ficam as regras que nunca podem regredir.
 */
const raiz = process.cwd();
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf8");

describe("a trava de ouro: rastreio nunca inventa venda", () => {
  it("pedido NÃO PAGO não anda (ENVIADO conta como faturamento)", () => {
    expect(statusDoPedidoPeloRastreio("ORCAMENTO", "POSTADO")).toBeNull();
    expect(statusDoPedidoPeloRastreio("AGUARDANDO_PAGAMENTO", "POSTADO")).toBeNull();
    expect(statusDoPedidoPeloRastreio("AGUARDANDO_PAGAMENTO", "ENTREGUE")).toBeNull();
  });
  it("pedido CANCELADO nunca é tocado", () => {
    expect(statusDoPedidoPeloRastreio("CANCELADO", "POSTADO")).toBeNull();
    expect(statusDoPedidoPeloRastreio("CANCELADO", "ENTREGUE")).toBeNull();
  });
  it("pedido pago anda: postado → ENVIADO, chegou → ENTREGUE", () => {
    expect(statusDoPedidoPeloRastreio("PAGO", "POSTADO")).toBe("ENVIADO");
    expect(statusDoPedidoPeloRastreio("EM_PRODUCAO", "POSTADO")).toBe("ENVIADO");
    expect(statusDoPedidoPeloRastreio("SEPARACAO", "POSTADO")).toBe("ENVIADO");
    expect(statusDoPedidoPeloRastreio("ENVIADO", "ENTREGUE")).toBe("ENTREGUE");
    // pacote entregue sem termos visto a postagem: pula direto, não perde
    expect(statusDoPedidoPeloRastreio("PAGO", "ENTREGUE")).toBe("ENTREGUE");
  });
  it("só para FRENTE: aviso atrasado não regride o pedido", () => {
    expect(statusDoPedidoPeloRastreio("ENTREGUE", "POSTADO")).toBeNull();
    expect(statusDoPedidoPeloRastreio("ENVIADO", "POSTADO")).toBeNull();
    expect(statusDoPedidoPeloRastreio("ENTREGUE", "ENTREGUE")).toBeNull();
  });
  it("situação desconhecida da transportadora não mexe em nada", () => {
    expect(statusDoRastreio("banana")).toBeNull();
    expect(statusDoRastreio(null)).toBeNull();
    expect(statusDoPedidoPeloRastreio("PAGO", null)).toBeNull();
  });
  it("tradução do status cru do Melhor Envio", () => {
    expect(statusDoRastreio("delivered")).toBe("ENTREGUE");
    expect(statusDoRastreio("posted")).toBe("POSTADO");
    expect(statusDoRastreio("cancelled")).toBe("CANCELADO");
    expect(statusDoRastreio("canceled")).toBe("CANCELADO");
  });
});

describe("a troca de status é atômica e registrada", () => {
  const lib = ler("src/lib/rastreio.ts");
  it("updateMany condicionado ao status que autorizou (duas rodadas não escrevem duas vezes)", () => {
    expect(lib).toContain("status: pedido.status");
    expect(lib).toContain("if (trocou.count === 0) return");
  });
  it("cada mudança vira histórico do pedido e aviso para a loja", () => {
    expect(lib).toContain("db.orderEvent.create");
    expect(lib).toContain("sendToCompany");
  });
  it("consulta que não responde não trava a fila (marca a tentativa)", () => {
    expect(lib).toContain("data: { trackedAt: agora }");
  });
  // GRAVE (revisão 14/08/2026): só chamar quando o ENVIO mudava deixava
  // parado para sempre o pedido cujo envio já estava POSTADO no banco
  it("o pedido é conferido em TODA consulta, não só quando o envio muda", () => {
    expect(lib).toContain("// SEMPRE tenta fazer o pedido andar");
    expect(lib).not.toMatch(/if \(mudou\) await fazerPedidoAndar/);
  });
  it("as datas de postagem/entrega vêm da transportadora quando ela manda", () => {
    expect(lib).toContain("tracking.postedAt ?? agora");
    expect(lib).toContain("tracking.deliveredAt ?? agora");
    expect(ler("src/lib/melhorenvio.ts")).toContain("posted_at");
  });
});

describe("varredura de carona (sem cron novo — regra do Vercel Hobby)", () => {
  const lib = ler("src/lib/rastreio.ts");
  it("trava global igual à do vigia: uma rodada por intervalo", () => {
    expect(lib).toContain("trackingRunAt");
    expect(lib).toContain("if (claimed.count === 0) return");
  });
  it("rodada pequena e só o que ainda pode mudar", () => {
    expect(lib).toContain("take: POR_RODADA");
    expect(lib).toContain("EM_TRANSITO");
    expect(lib).toContain("suspended: false"); // loja suspensa não gasta chamada
  });
  it("pega carona nas rotas movimentadas e no cron que já existe", () => {
    expect(ler("src/app/api/conversations/route.ts")).toContain("atualizarRastreiosSeDevido");
    expect(ler("src/app/api/cron/jueri-sync/route.ts")).toContain("atualizarRastreiosSeDevido");
  });
  it("no cron, o rastreio roda ANTES da fila longa (não queima a vaga da madrugada)", () => {
    const cron = ler("src/app/api/cron/jueri-sync/route.ts");
    expect(cron.indexOf("atualizarRastreiosSeDevido()")).toBeLessThan(
      cron.indexOf("const inicio = Date.now()")
    );
  });
  it("envio ENTREGUE cujo pedido ainda não sabe volta para a fila", () => {
    expect(lib).toContain('meStatus: "ENTREGUE"');
    expect(lib).toContain('(s) => s !== "ENTREGUE"');
  });
  it("nenhum cron novo entrou no vercel.json (um 3º bloqueia TODOS os deploys)", () => {
    const crons = JSON.parse(ler("vercel.json")).crons ?? [];
    expect(crons.length).toBeLessThanOrEqual(2);
  });
});

describe("a etiqueta comprada preenche o pedido sozinha", () => {
  const rota = ler("src/app/api/orders/[id]/frete/route.ts");
  it("meio de envio vira transportadora + serviço (Correios PAC)", () => {
    expect(rota).toContain("const meioDeEnvio =");
    expect(rota).toContain("[parsed.data.carrier, parsed.data.service]");
    expect(rota).toContain("method: meioDeEnvio");
  });
  it("o link público nasce com a etiqueta e não muda depois", () => {
    expect(rota).toContain("order.shipping?.publicCode ?? novoCodigoPublico()");
  });
  it("a consulta de rastreio usa a régua única (não copia a lógica)", () => {
    expect(rota).toContain("aplicarRastreio({");
  });
});

describe("o link que a cliente abre", () => {
  it("código sorteado, nunca o id do pedido", () => {
    const a = novoCodigoPublico();
    const b = novoCodigoPublico();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(10);
    expect(linkDoRastreio(a)).toContain(`/rastreio/${a}`);
  });
  it("a página é pública (passa pelo middleware) e não vaza a ficha", () => {
    expect(ler("src/middleware.ts")).toContain('"/rastreio/"');
    const pg = ler("src/app/rastreio/[codigo]/page.tsx");
    // endereço, valores e telefone NUNCA aparecem: o link circula no WhatsApp
    expect(pg).not.toContain("street");
    expect(pg).not.toContain("total");
    expect(pg).not.toContain("phone");
    expect(pg).toContain("publicCode: codigo");
  });
  it("pedido/etiqueta cancelada não mostra rastreio", () => {
    const pg = ler("src/app/rastreio/[codigo]/page.tsx");
    expect(pg).toContain('envio.meStatus === "CANCELADO"');
    expect(pg).toContain('envio.order.status === "CANCELADO"');
  });
  it("mandar no WhatsApp respeita o escopo de pedidos e registra no histórico", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain("orderScope(user)");
    expect(rota).toContain("sendMessage({");
    expect(rota).toContain("db.orderEvent.create");
  });
  // o engine grava FALHOU em vez de lançar: sem conferir, a tela dizia
  // "Enviado!" para uma mensagem que a cliente nunca recebeu
  it("WhatsApp fora do ar NÃO diz que enviou", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain('enviada.status === "FALHOU"');
    expect(rota).toContain("status: 502");
  });
  it("o texto não promete 'a caminho' antes de a caixa sair", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain("const jaSaiu =");
    expect(rota).toContain("sendo preparado para envio");
  });
  it("copiar link não perde o gesto do iPhone e não mente ao falhar", () => {
    const tela = ler("src/app/(app)/pedidos/[id]/envio-frete.tsx");
    expect(tela).toContain("if (!linkRastreio)"); // link já em mãos
    expect(tela).toContain("const deu = await copiarTexto(linkRastreio)");
    expect(tela).toContain("if (!deu)");
  });
});

describe("como a cliente pagou aparece no pedido", () => {
  it("parcelas do cartão vêm da confirmação (6x vira 6x na tela)", () => {
    expect(ler("src/lib/infinitepay.ts")).toContain("installments: parcelas");
    expect(ler("src/app/(app)/pedidos/[id]/page.tsx")).toContain("p.installments");
  });
  it("a migração é reexecutável e está na lista do destravador", () => {
    expect(ler("prisma/migrations/20260814120000_rastreio_automatico/migration.sql")).toContain(
      "IF NOT EXISTS"
    );
    expect(ler("scripts/migrate-deploy.mjs")).toContain("20260814120000_rastreio_automatico");
  });
});
