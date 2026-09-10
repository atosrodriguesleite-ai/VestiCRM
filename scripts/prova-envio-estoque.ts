/* eslint-disable */
/**
 * PROVA PONTA A PONTA DA RN-053 contra o Postgres LOCAL, com a Nuvemshop
 * SIMULADA (um servidor HTTP local que aceita, recusa ou some) — é o único
 * jeito honesto de provar "o envio recusado volta a ser tentado" sem mexer na
 * loja de verdade de ninguém.
 *
 * Cria loja de teste com nome sorteado, roda os cenários e apaga tudo no fim.
 * NUNCA roda contra produção: a trava abaixo exige a porta 5433 do Postgres
 * local (regra da casa: "NUNCA rodar db:seed em produção").
 *
 * Uso: set -a; source .env; set +a; npx tsx scripts/prova-envio-estoque.ts
 */
if (!/(localhost|127\.0\.0\.1):5433\b/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("prova-envio-estoque só roda contra o Postgres LOCAL (porta 5433)");
}
import http from "node:http";
import { db } from "../src/lib/db";
import { encryptSecret } from "../src/lib/crypto";

const tag = `rn053-${Date.now()}`;
let falhas = 0;
function ok(cond: unknown, msg: string) {
  if (!cond) {
    console.error("❌ FALHOU:", msg);
    falhas++;
    process.exitCode = 1;
  } else console.log("✅", msg);
}

/** A "Nuvemshop": responde o que o cenário mandar e anota o que recebeu. */
type Modo = "aceita" | "recusa" | "erro500";
let modo: Modo = "aceita";
const recebidos: { path: string; stock: number }[] = [];

async function main() {
  const servidor = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      recebidos.push({ path: req.url ?? "", stock: JSON.parse(corpo || "{}").stock });
      if (modo === "aceita") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      } else if (modo === "recusa") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"code":401}');
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end('{"code":500}');
      }
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as { port: number }).port;
  process.env.NUVEMSHOP_API_BASE = `http://127.0.0.1:${porta}`;

  // o módulo lê a env na chamada (nuvemshopEnv()), então importar depois de
  // apontar a base é seguro — mas importamos dinamicamente para não haver dúvida
  const { pushStockToNuvemshop, varrerEnviosDeEstoqueSeDevido } = await import(
    "../src/lib/nuvemshop"
  );
  const fila = await import("../src/lib/nuvemshop-estoque-pendente");

  const loja = await db.company.create({
    data: { name: `Loja ${tag}`, slug: tag, estoqueEnabled: true },
  });
  await db.nuvemshopConnection.create({
    data: {
      companyId: loja.id,
      storeId: "123",
      accessToken: encryptSecret("token-de-teste"),
      status: "CONECTADO",
    },
  });
  const produto = await db.product.create({
    data: {
      companyId: loja.id,
      name: "Regata Quadrada",
      sku: "RQ",
      category: "Regatas",
      nuvemshopId: "nsp-1",
      variants: {
        create: [
          { color: "Terracota", size: "GG", stock: 0, nuvemshopId: "nsv-1", sku: "RQD-TER-GG" },
          { color: "Terracota", size: "P", stock: 5, nuvemshopId: "nsv-2", sku: "RQD-TER-P" },
          // peça NOSSA (sem vínculo): a Nuvemshop não manda nela
          { color: "Terracota", size: "M", stock: 7, sku: "RQD-TER-M" },
          // peça no "infinito" da Nuvemshop: não se espelha (RN-014)
          { color: "Preto", size: "U", stock: 9999, nuvemshopId: "nsv-3", sku: "RQD-PRE-U" },
        ],
      },
    },
    include: { variants: true },
  });
  const gg = produto.variants.find((v) => v.size === "GG")!;
  const p = produto.variants.find((v) => v.size === "P")!;
  const m = produto.variants.find((v) => v.size === "M")!;
  const infinita = produto.variants.find((v) => v.color === "Preto")!;
  const todas = produto.variants.map((v) => v.id);

  const naFila = (variantId: string) =>
    db.nuvemshopEstoquePendente.findUnique({ where: { variantId } });
  /**
   * Simula o tempo passando entre duas rodadas, pela porta pública: devolver
   * a trava é o caminho que a própria repesca usa quando a rodada quebra —
   * ele solta o carimbo do banco E o freio em memória da instância.
   */
  const soltarTrava = async () => {
    const c = await db.company.findUnique({
      where: { id: loja.id },
      select: { nsEstoqueRunAt: true },
    });
    await fila.devolverTravaDaRepesca(loja.id, c?.nsEstoqueRunAt ?? new Date(0));
  };

  // ---- 1. caminho feliz: a Nuvemshop aceita → nada fica na fila -----------
  modo = "aceita";
  recebidos.length = 0;
  await pushStockToNuvemshop(loja.id, todas);
  ok(recebidos.length === 2, `só as peças vinculadas e finitas são enviadas (foram ${recebidos.length})`);
  ok(
    recebidos.some((r) => r.path.includes("nsv-1") && r.stock === 0),
    "o GG sai com o número de AQUI (0) — é a baixa que não chegava"
  );
  ok(!recebidos.some((r) => r.path.includes("nsv-3")), "peça no infinito da Nuvemshop NÃO é espelhada");
  ok((await naFila(gg.id)) === null, "envio confirmado sai da fila");
  ok((await naFila(m.id)) === null, "peça sem vínculo nem entra na fila");
  ok((await naFila(infinita.id)) === null, "peça infinita nem entra na fila");

  // ---- 2. a Nuvemshop RECUSA → a peça FICA na fila, com o motivo ----------
  modo = "recusa";
  await pushStockToNuvemshop(loja.id, [gg.id]);
  const depoisDaRecusa = await naFila(gg.id);
  ok(depoisDaRecusa !== null, "envio recusado NÃO é esquecido: a peça fica na fila");
  ok(depoisDaRecusa?.tentativas === 1, "conta a tentativa que falhou");
  ok(
    (depoisDaRecusa?.ultimoErro ?? "").includes("recusou"),
    `o motivo fica escrito em português ("${depoisDaRecusa?.ultimoErro}")`
  );
  ok(
    depoisDaRecusa?.proximaEm !== null && depoisDaRecusa!.proximaEm! > new Date(),
    "a próxima tentativa é agendada para o futuro (espera crescente)"
  );

  // ---- 3. a MESMA peça vendendo de novo NÃO empilha na fila ---------------
  await pushStockToNuvemshop(loja.id, [gg.id]);
  const linhas = await db.nuvemshopEstoquePendente.count({ where: { variantId: gg.id } });
  ok(linhas === 1, "uma fila por PEÇA: a venda seguinte atualiza, não empilha");

  // ---- 4. a repesca ainda não é hora (a espera não venceu) ----------------
  recebidos.length = 0;
  await soltarTrava();
  await varrerEnviosDeEstoqueSeDevido(loja.id);
  ok(recebidos.length === 0, "a repesca respeita a espera: peça não vencida não é tentada");

  // ---- 5. vencida a espera, a repesca tenta de novo e ACERTA --------------
  // (simula o tempo passando; e o estoque mudou no meio: vale o de AGORA)
  await db.productVariant.update({ where: { id: gg.id }, data: { stock: 41 } });
  await db.nuvemshopEstoquePendente.update({
    where: { variantId: gg.id },
    data: { proximaEm: new Date(Date.now() - 1000) },
  });
  modo = "aceita";
  recebidos.length = 0;
  await soltarTrava();
  await varrerEnviosDeEstoqueSeDevido(loja.id);
  ok(recebidos.length === 1, "a repesca tenta a peça vencida");
  ok(recebidos[0]?.stock === 41, "manda o estoque de AGORA (41), não o número velho");
  ok((await naFila(gg.id)) === null, "confirmado, sai da fila — e os dois lados voltam a bater");

  // ---- 6. a trava por loja: duas batidas juntas, uma rodada só -----------
  modo = "recusa";
  await pushStockToNuvemshop(loja.id, [p.id]);
  await db.nuvemshopEstoquePendente.update({
    where: { variantId: p.id },
    data: { proximaEm: new Date(Date.now() - 1000) },
  });
  recebidos.length = 0;
  await soltarTrava();
  modo = "aceita";
  await Promise.all([
    varrerEnviosDeEstoqueSeDevido(loja.id),
    varrerEnviosDeEstoqueSeDevido(loja.id),
    varrerEnviosDeEstoqueSeDevido(loja.id),
  ]);
  ok(recebidos.length === 1, `três batidas juntas = UMA rodada (foram ${recebidos.length} envios)`);

  // ---- 7. acabaram as tentativas: desiste, mas DIZENDO --------------------
  modo = "erro500";
  await pushStockToNuvemshop(loja.id, [gg.id]);
  for (let i = 0; i < fila.MAX_TENTATIVAS_ESTOQUE + 1; i++) {
    const linha = await naFila(gg.id);
    // já desistiu (sem data) — parar aqui; re-armar seria o teste inventando
    // uma tentativa que a vida real não faz
    if (!linha || linha.proximaEm === null) break;
    await db.nuvemshopEstoquePendente.update({
      where: { variantId: gg.id },
      data: { proximaEm: new Date(Date.now() - 1000) },
    });
    await soltarTrava();
    await varrerEnviosDeEstoqueSeDevido(loja.id);
  }
  const desistida = await naFila(gg.id);
  ok(desistida !== null && desistida.proximaEm === null,
    "acabadas as tentativas, a peça PARA de ser tentada mas o ⚠️ continua na tela");
  const aviso = await db.commEvent.findFirst({
    where: { companyId: loja.id, type: "nuvemshop.estoque-nao-enviado" },
  });
  ok(aviso !== null, "a desistência VIRA registro na Central de Comunicação");
  ok(
    (aviso?.payload ?? "").includes("Regata Quadrada"),
    "o registro diz QUAL peça ficou para trás"
  );
  const naSaude = await db.errorLog.findFirst({
    where: { path: "/nuvemshop/estoque", message: { contains: "Regata Quadrada" } },
    orderBy: { createdAt: "desc" },
  });
  ok(naSaude !== null, "e vai também para o painel de Saúde");

  // ---- 7b. desistência NÃO vira spam: venda nova tenta, sem repetir o alarme
  const antesDoSpam = await db.commEvent.count({
    where: { companyId: loja.id, type: "nuvemshop.estoque-nao-enviado" },
  });
  await pushStockToNuvemshop(loja.id, [gg.id]);
  await pushStockToNuvemshop(loja.id, [gg.id]);
  const depoisDoSpam = await db.commEvent.count({
    where: { companyId: loja.id, type: "nuvemshop.estoque-nao-enviado" },
  });
  ok(
    antesDoSpam === 1 && depoisDoSpam === 1,
    `o alarme toca UMA vez por rodada, não a cada venda (${antesDoSpam} → ${depoisDoSpam})`
  );

  // ---- 7c. …e quando a Nuvemshop volta, a peça se acerta sozinha ----------
  modo = "aceita";
  await pushStockToNuvemshop(loja.id, [gg.id]);
  ok((await naFila(gg.id)) === null, "envio confirmado depois da desistência limpa o ⚠️");

  // ---- 8. loja DESCONECTADA não perde a baixa ----------------------------
  await db.nuvemshopConnection.update({
    where: { companyId: loja.id },
    data: { status: "DESCONECTADO" },
  });
  recebidos.length = 0;
  await pushStockToNuvemshop(loja.id, [p.id]);
  ok(recebidos.length === 0, "loja desconectada não tenta enviar");
  ok((await naFila(p.id)) !== null, "…mas a peça FICA na fila esperando a reconexão");

  // ---- 9. o ⚠️ chega na tela ---------------------------------------------
  const pendentes = await fila.envioPendentePorVariacao(loja.id, todas);
  ok(pendentes.has(p.id), "a tela sabe quais peças estão com envio pendente (⚠️ na linha)");
  ok(!pendentes.has(m.id), "peça sem pendência não ganha ⚠️");

  // ---- 10. isolamento multi-tenant (RN-013) ------------------------------
  const outra = await db.company.create({
    data: { name: `Outra ${tag}`, slug: `${tag}-b` },
  });
  const daOutra = await fila.envioPendentePorVariacao(outra.id, todas);
  ok(daOutra.size === 0, "a fila de uma loja NUNCA aparece para outra (RN-013)");

  // ---- limpeza ------------------------------------------------------------
  await db.errorLog.deleteMany({ where: { path: "/nuvemshop/estoque" } });
  await db.company.deleteMany({ where: { id: { in: [loja.id, outra.id] } } });
  servidor.close();
  console.log(falhas === 0 ? "\n🎉 RN-053 provada ponta a ponta." : `\n💥 ${falhas} falha(s).`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await db.$disconnect();
});
