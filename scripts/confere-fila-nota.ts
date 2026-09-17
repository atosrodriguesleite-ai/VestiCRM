/**
 * CONFERE A FILA "FALTA NOTA" CONTRA O BANCO (RN-058).
 *
 * Rodar: `set -a && source .env && set +a && npx tsx scripts/confere-fila-nota.ts`
 *
 * Existe porque a regra vive em DOIS lugares que precisam concordar: a função
 * pura (`precisaDeNota`, que o teste guarda) e a cláusula Prisma da tela. Este
 * script cria as 48 combinações de status × situação da nota e confere uma a
 * uma — divergência entre as duas passaria em qualquer teste unitário.
 *
 * O caso que o motivou: `nfeStatus: { not: "AUTORIZADA" }` sozinho **NÃO pega
 * quem está NULO** em SQL, e nulo é o pedido que nunca emitiu — a maioria da
 * fila. Escrito assim, o filtro nasceria escondendo justamente o que ele
 * existe para mostrar, sem erro nenhum. O script prova a diferença em números.
 */
import { db } from "@/lib/db";
import { PAID_ORDER_STATUSES } from "@/lib/orders";
import { ONDE_FALTA_NOTA, precisaDeNota } from "@/lib/nfe-situacao";

// SÓ POSTGRES LOCAL, como os scripts irmãos: ele CRIA lojas e pedidos falsos,
// e rodado com o .env apontando para o Neon sujaria a base de lojas reais
if (!/(localhost|127\.0\.0\.1):5433\b/.test(process.env.DATABASE_URL ?? ""))
  throw new Error("só local (porta 5433)");

const ok = (c: boolean, m: string) => console.log(`${c ? "✅" : "❌ FALHOU"} ${m}`);
let falhas = 0;
const check = (c: boolean, m: string) => { if (!c) falhas++; ok(c, m); };

// a MESMA cláusula que a tela usa — conferir uma cópia não provaria nada
const ondeFaltaNota = ONDE_FALTA_NOTA;

async function main() {
  const suf = Date.now().toString(36);
  const company = await db.company.create({ data: { name: `Fila ${suf}`, slug: `fila-${suf}` } });
  const cid = company.id;
  paraLimpar.push(cid);
  const cliente = await db.customer.create({
    data: { companyId: cid, name: "Cliente Teste", phone: `5533${suf.slice(-8)}` },
  });

  // todas as combinações que existem na vida da loja
  const STATUS = ["ORCAMENTO", "AGUARDANDO_PAGAMENTO", "PAGO", "EM_PRODUCAO",
                  "SEPARACAO", "ENVIADO", "ENTREGUE", "CANCELADO"] as const;
  const NFE = [null, "AUTORIZADA", "REJEITADA", "CANCELADA", "ERRO", "EMITINDO"] as const;

  let n = 0;
  const criados: { id: string; status: string; nfeStatus: string | null }[] = [];
  for (const status of STATUS) {
    for (const nfeStatus of NFE) {
      n++;
      const o = await db.order.create({
        data: {
          companyId: cid, customerId: cliente.id, number: n,
          status: status as never, nfeStatus,
          subtotal: 100, total: 100, netTotal: 100,
        },
      });
      criados.push({ id: o.id, status, nfeStatus });
    }
  }
  console.log(`\n${criados.length} pedidos criados (${STATUS.length} status × ${NFE.length} situações de nota)\n`);

  const naFila = await db.order.findMany({
    where: { companyId: cid, ...ondeFaltaNota },
    select: { id: true, status: true, nfeStatus: true },
  });
  const idsNaFila = new Set(naFila.map((o) => o.id));

  // a consulta tem que concordar com a regra pura, caso a caso
  let divergencias = 0;
  for (const c of criados) {
    const deveria = precisaDeNota(c.status, c.nfeStatus, PAID_ORDER_STATUSES);
    const esta = idsNaFila.has(c.id);
    if (deveria !== esta) {
      divergencias++;
      console.log(`   ❌ ${c.status} / nota=${c.nfeStatus ?? "NULA"}: regra diz ${deveria}, banco diz ${esta}`);
    }
  }
  check(divergencias === 0, `a consulta concorda com a regra nas ${criados.length} combinações`);

  // o caso que motivou a cláusula escrita à mão
  const nulosNaFila = naFila.filter((o) => o.nfeStatus === null).length;
  check(nulosNaFila === PAID_ORDER_STATUSES.length,
    `pedido pago que NUNCA emitiu entra na fila (${nulosNaFila} de ${PAID_ORDER_STATUSES.length})`);

  // e o que NÃO pode entrar
  check(!naFila.some((o) => o.nfeStatus === "AUTORIZADA"), "nota autorizada NUNCA entra na fila");
  check(!naFila.some((o) => o.status === "CANCELADO"), "pedido cancelado não precisa de nota");
  check(!naFila.some((o) => o.status === "ORCAMENTO"), "orçamento não está esperando nota");
  check(!naFila.some((o) => o.status === "AGUARDANDO_PAGAMENTO"),
    "aguardando pagamento também não (a emissão recusa antes de pago)");
  check(naFila.some((o) => o.nfeStatus === "REJEITADA"), "nota RECUSADA volta para a fila");
  check(naFila.some((o) => o.nfeStatus === "EMITINDO"),
    "a que está EMITINDO fica na fila (travada, não pode sumir)");

  // prova de que `not` SOZINHO erraria — é por isso que a cláusula tem o OR
  const semOr = await db.order.count({
    where: { companyId: cid, status: { in: [...PAID_ORDER_STATUSES] }, nfeStatus: { not: "AUTORIZADA" } },
  });
  console.log(`\n   cláusula com OR: ${naFila.length} · sem o OR: ${semOr}`);
  check(naFila.length > semOr,
    `sem o OR o SQL perderia os nulos (${naFila.length - semOr} pedidos que nunca emitiram)`);

  // RN-013: outra loja não enxerga esta fila
  const outra = await db.company.create({ data: { name: `Outra ${suf}`, slug: `outra-f-${suf}` } });
  paraLimpar.push(outra.id);
  const foraCount = await db.order.count({ where: { companyId: outra.id, ...ondeFaltaNota } });
  check(foraCount === 0, "outra loja não vê a fila desta (RN-013)");

  console.log(falhas === 0 ? "\n🎉 TUDO CERTO" : `\n💥 ${falhas} FALHA(S)`);
  return falhas;
}

/**
 * A limpeza é ESPERADA antes de sair. `process.exit()` num `.then()` mata o
 * processo na hora e o `.finally()` encadeado nunca chega a rodar — foi assim
 * que a primeira versão deixou duas lojas de teste no banco local.
 */
const paraLimpar: string[] = [];
(async () => {
  let codigo = 1;
  try {
    codigo = (await main()) === 0 ? 0 : 1;
  } catch (e) {
    console.error(e);
  } finally {
    if (paraLimpar.length) {
      await db.company.deleteMany({ where: { id: { in: paraLimpar } } });
      console.log(`   (lojas de teste removidas: ${paraLimpar.length})`);
    }
  }
  process.exit(codigo);
})();
