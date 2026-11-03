/**
 * PROVA DE PONTA A PONTA — "Colar pedido do WhatsApp" numa loja que cadastra
 * UM PRODUTO POR COR com o mesmo nome (Toque Leve, relato do dono em
 * 03/11/2026: todas as "Regata Alça" do pedido da Tânia viravam "cafe · M").
 *
 * Cria a loja de teste no Postgres local, lê o catálogo com a MESMA consulta
 * da rota (`/api/orders/ler-mensagem`) e passa a mensagem de verdade pela
 * régua da lib (RN-012). Apaga a loja no fim.
 *
 *   DATABASE_URL="postgresql://…:5433/vesti" npx tsx scripts/e2e-colar-pedido-por-cor.ts
 */
import { db } from "@/lib/db";
import {
  candidatosDaLinha,
  casarPecaNosCandidatos,
  fraseSemVariacao,
  lerMensagemDePedido,
} from "@/lib/catalogo/ler-mensagem";

const ok = (t: string) => console.log(`  ✅ ${t}`);
const falha = (t: string) => {
  console.log(`  ❌ ${t}`);
  process.exitCode = 1;
};
const conferir = (cond: boolean, t: string) => (cond ? ok(t) : falha(t));

const MENSAGEM = `*Novo pedido — Toque Leve*

*Regata Alça*
• Regata Alça Amarelo Manteiga — M ×1  (1 peça · R$ 32,00)
• Regata Alça cafe — M ×1  (1 peça · R$ 32,00)
• Regata Alça Azul Céu — G ×1  (1 peça · R$ 32,00)
• Regata Alça Terracota — M ×1  (1 peça · R$ 32,00)
• Regata Alça Verde Militar — M ×1  (1 peça · R$ 32,00)
• Regata Alça Branco — M ×1  (1 peça · R$ 32,00)

*Ombro Único*
• Ombro Único Verde Militar — M ×1, GG ×1  (2 peças · R$ 66,00)
• Ombro Único Café — M ×2  (2 peças · R$ 66,00)

*Total:* 10 peças · R$ 324,00

*Cliente*
Nome: Maria Tânia Batista França
Telefone: (33) 99995-6375
CEP: 39625000

_Valores sujeitos a confirmação._`;

async function main() {
  const marca = Date.now();
  const company = await db.company.create({
    data: { name: `Toque Teste ${marca}`, slug: `toque-teste-${marca}`, whatsapp: "5533999990000" },
  });
  try {
    // um produto por cor, TODOS com o mesmo nome — o Verde Militar da Regata
    // Alça fica de fora de propósito (a cor que não existe não pode virar outra)
    const grade = (cor: string, tamanhos: string[]) =>
      tamanhos.map((size) => ({ color: cor, size, stock: 3 }));
    const cadastros: [string, string, string[]][] = [
      ["Regata Alça", "cafe", ["P", "M", "G"]],
      ["Regata Alça", "Amarelo Manteiga", ["M", "G"]],
      ["Regata Alça", "Azul Céu", ["M", "G"]],
      ["Regata Alça", "Terracota", ["M"]],
      ["Regata Alça", "Branco", ["M", "G"]],
      ["Ombro Único", "Verde Militar", ["M", "GG"]],
      ["Ombro Único", "Café", ["M"]],
      ["Ombro Único", "Preto", ["G"]],
    ];
    let i = 0;
    for (const [name, cor, tamanhos] of cadastros) {
      await db.product.create({
        data: {
          companyId: company.id,
          name,
          sku: `TQ-${marca}-${i++}`,
          category: name,
          retailPrice: 49.9,
          wholesalePrice: 32,
          variants: { create: grade(cor, tamanhos) },
        },
      });
    }

    // A MESMA consulta da rota
    const produtos = await db.product.findMany({
      where: { companyId: company.id, active: true },
      select: {
        id: true,
        name: true,
        retailPrice: true,
        wholesalePrice: true,
        category: true,
        sobEncomenda: true,
        jueriId: true,
        variants: { select: { id: true, color: true, size: true, stock: true } },
      },
    });
    conferir(produtos.length === 8, "catálogo lido pela consulta da rota (8 cadastros, 2 nomes)");

    const lido = lerMensagemDePedido(MENSAGEM);
    conferir(lido.itens.length === 8, `a mensagem tem 8 linhas lidas (${lido.itens.length})`);

    const saida: { descricao: string; tamanho: string; cor: string | null; problema: string | null }[] = [];
    for (const item of lido.itens) {
      const candidatos = candidatosDaLinha(item, produtos);
      for (const t of item.tamanhos) {
        const a = casarPecaNosCandidatos(candidatos, t.tamanho, t.quantidade);
        saida.push({
          descricao: item.descricao,
          tamanho: t.tamanho,
          cor: a?.variante?.color ?? null,
          problema: a && !a.variante ? fraseSemVariacao(a.motivo!, a.cor, t.tamanho, candidatos[0]?.length ?? 1) : null,
        });
      }
    }
    for (const l of saida) console.log(`     ${l.descricao} · ${l.tamanho} → ${l.cor ?? "—"}${l.problema ? ` (${l.problema})` : ""}`);

    const cores = saida.map((l) => l.cor);
    conferir(
      JSON.stringify(cores) ===
        JSON.stringify([
          "Amarelo Manteiga",
          "cafe",
          "Azul Céu",
          "Terracota",
          null,
          "Branco",
          "Verde Militar",
          "Verde Militar",
          "Café",
        ]),
      "cada linha caiu na SUA cor (nenhuma virou Café por engano)"
    );
    const verde = saida[4];
    conferir(
      verde.cor === null && verde.problema === "Sem essa variação (Verde Militar M)",
      "a cor que a loja não cadastrou NÃO virou outra: a linha volta em vermelho com a frase"
    );
    // o mesmo produto, dois tamanhos, com a conta do nome feita uma vez
    conferir(saida[6].cor === "Verde Militar" && saida[7].cor === "Verde Militar", "linha com dois tamanhos (M e GG) casa os dois");
    // cada variação escolhida é DO produto da cor certa (é o variantId que a
    // criação do pedido vai reservar, RN-003)
    const manteiga = produtos.find((p) => p.variants.some((v) => v.color === "Amarelo Manteiga"))!;
    const cand = candidatosDaLinha(lido.itens[0], produtos);
    conferir(casarPecaNosCandidatos(cand, "M", 1)?.produto.id === manteiga.id, "o productId/variantId devolvidos são do cadastro Amarelo Manteiga");
  } finally {
    await db.company.delete({ where: { id: company.id } });
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
