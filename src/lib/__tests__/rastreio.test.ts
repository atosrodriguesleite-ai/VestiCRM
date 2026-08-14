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
    expect(lib).toContain("status: pedido.status as never");
    expect(lib).toContain("if (r.count === 0) return false");
  });
  it("status e histórico na MESMA transação (nunca muda em silêncio)", () => {
    expect(lib).toContain("db.$transaction(async (tx) => {");
    expect(lib).toContain("tx.order.updateMany");
    expect(lib).toContain("tx.orderEvent.create");
  });
  it("aviso vai para a DONA do pedido (não para a loja inteira) e deixa rastro no sino", () => {
    expect(lib).toContain("sendToUser");
    expect(lib).not.toContain("sendToCompany");
    expect(lib).toContain("db.notification");
    expect(lib).toContain("pedido.sellerId");
  });
  it("a mesma transição não é aplicada duas vezes (decisão humana vence)", () => {
    expect(lib).toContain("MARCA_AUTO[novo]");
    expect(lib).toContain("if (jaFez) return");
  });
  it("entrega em pedido CANCELADO vira aviso (estoque fantasma) e não passa em silêncio", () => {
    expect(lib).toContain("ENTREGOU um pedido CANCELADO");
    expect(lib).toContain("soGerencia: true");
  });
  it("pacote devolvido ao remetente vira aviso, sem mexer no status", () => {
    expect(lib).toContain('"DEVOLVIDO"');
    expect(lib).toContain("DEVOLUÇÃO AO REMETENTE");
  });
  it("a situação do envio nunca REGRIDE (o ME oscila entre posted/delivered)", () => {
    expect(lib).toContain("podeAvancarEnvio(envio.meStatus, resposta)");
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
    expect(lib).toContain("tracking.deliveredAt ?? agora");
    // entrega sem postagem informada usa a própria entrega, nunca "agora":
    // senão a página mostrava "A caminho" numa data DEPOIS de "Entregue"
    expect(lib).toContain('tracking.postedAt ?? (situacao === "ENTREGUE" ? entregou : agora)');
    const me = ler("src/lib/melhorenvio.ts");
    expect(me).toContain("posted_at");
    // fuso de Brasília: sem isso, evento da madrugada aparecia um dia antes
    expect(me).toContain('`${iso}-03:00`');
    expect(me).toContain("Date.UTC(2020, 0, 1)"); // janela de sanidade
    expect(me).toContain("AbortSignal.timeout"); // ME lento não segura a função
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
  it("no cron: rastreio antes da fila longa, mas o RELÓGIO conta o tempo dele", () => {
    const cron = ler("src/app/api/cron/jueri-sync/route.ts");
    // o marco zero vem primeiro; senão o guard de 240s achava que tinha a
    // rodada inteira e a Vercel cortava o Jueri no meio, sem rastro
    expect(cron.indexOf("const inicio = Date.now()")).toBeLessThan(
      cron.indexOf("atualizarRastreiosSeDevido()")
    );
  });
  it("loja sem o módulo Envios (não contratado) fica FORA da varredura", () => {
    expect(lib).toContain("shippingEnabled: true");
  });
  it("a fila não acumula peso morto (cancelado e etiqueta parada saem)", () => {
    expect(lib).toContain('status: { not: "CANCELADO" as never }');
    expect(lib).toContain("DESISTE_SEM_POSTAR_MS");
    expect(lib).toContain("DESISTE_EM_TRANSITO_MS");
  });
  it("as consultas saem em lotes paralelos (em série estouravam o tempo)", () => {
    expect(lib).toContain("Promise.allSettled");
    expect(lib).toContain("envios.slice(i, i + LOTE)");
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
  it("loja suspensa não serve a página pública (igual catálogo e bio)", () => {
    expect(ler("src/app/rastreio/[codigo]/page.tsx")).toContain(
      "order: { company: { suspended: false } }"
    );
  });
  it("o passo também acompanha o STATUS DO PEDIDO (loja marcou na mão)", () => {
    const pg = ler("src/app/rastreio/[codigo]/page.tsx");
    expect(pg).toContain("indiceDoPasso(envio.meStatus, envio.order.status)");
    expect(pg).toContain('statusPedido === "ENVIADO"');
    // não promete embalagem que a loja pode não ter feito
    expect(pg).toContain("Preparando seu pedido");
    expect(pg).not.toContain("Pedido embalado");
  });
  it("a etiqueta comprada NÃO pisa no meio de envio escolhido à mão", () => {
    expect(ler("src/app/api/orders/[id]/frete/route.ts")).toContain(
      "order.shipping?.method?.trim() ? {} : { method: meioDeEnvio }"
    );
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
  it("copiar link/mensagem não mente ao falhar, e tem plano B se a busca falhou", () => {
    const tela = ler("src/app/(app)/pedidos/[id]/envio-frete.tsx");
    expect(tela).toContain("const deu = await copiarTexto(link)");
    expect(tela).toContain("if (!deu)");
    expect(tela).toContain("copiarMensagem"); // texto pronto p/ WhatsApp Web
  });
  it("internet caindo não deixa o botão girando para sempre", () => {
    const tela = ler("src/app/(app)/pedidos/[id]/envio-frete.tsx");
    expect(tela).toContain("Sua internet caiu no meio do envio");
    expect(tela).toContain("Sua internet oscilou"); // vale para comprar etiqueta
  });
  it("pedido cancelado não oferece mandar rastreio (tela e servidor)", () => {
    expect(ler("src/app/(app)/pedidos/[id]/envio-frete.tsx")).toContain("{!isCancelled && (");
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain('order.status === "CANCELADO"');
  });
  it("nome que o SISTEMA inventou não vira 'Oi Contato!'", () => {
    expect(ler("src/app/api/orders/[id]/rastreio/route.ts")).toContain("nomeProvisorio");
    expect(ler("src/app/rastreio/[codigo]/page.tsx")).toContain("nomeProvisorio");
  });
  it("WhatsApp não conectado recusa antes de fingir que enviou", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain('cfg.activeProvider === "MOCK"');
  });
  it("trava de 10 min por pedido (clique repetido não vira spam/ban)", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain("MARCA_ENVIO_RASTREIO");
    expect(rota).toContain("status: 429");
  });
  it("o envio proativo tem folga de tempo (anti-ban espera 4-9s antes de sair)", () => {
    expect(ler("src/app/api/orders/[id]/rastreio/route.ts")).toContain("maxDuration = 60");
  });
  it("o código público nasce atômico (link já mandado não morre)", () => {
    const rota = ler("src/app/api/orders/[id]/rastreio/route.ts");
    expect(rota).toContain("db.shipping.updateMany");
    expect(rota).toContain("publicCode: null");
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
