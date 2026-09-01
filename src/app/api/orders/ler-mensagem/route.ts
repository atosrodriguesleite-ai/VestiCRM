import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  campanhaNoTexto,
  descontoNoTexto,
  descontoDoResgate,
  precoComDesconto,
} from "@/lib/catalogo/condicoes-da-campanha";
import { modoValido, tabelaNoTexto } from "@/lib/catalogo/tabelas-de-preco";
import { catalogPrice } from "@/lib/orders";
import { phoneMatchVariants, normalizePhone } from "@/lib/intake";
import {
  candidatosDeCor,
  lerMensagemDePedido,
  normalizar,
  pecasLidas,
  separarProdutoECor,
} from "@/lib/catalogo/ler-mensagem";

const schema = z.object({ texto: z.string().min(10).max(20000) });

/**
 * PRÉVIA DO PEDIDO A PARTIR DA MENSAGEM DO WHATSAPP.
 *
 * A vendedora cola a mensagem que a cliente mandou e esta rota devolve o
 * pedido montado: cada peça casada com o catálogo da loja, o preço vindo
 * do NOSSO cadastro (nunca do texto colado — número em mensagem se digita
 * errado e se edita à vontade) e a cliente localizada pelo telefone.
 *
 * Aqui NADA é gravado. É prévia: a vendedora confere na tela, ajusta o que
 * precisar e só então cria o pedido pelo caminho normal. O que esta rota
 * economiza é a digitação — a conferência continua sendo de gente.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Cole a mensagem do pedido" }, { status: 400 });
    }

    const lido = lerMensagemDePedido(parsed.data.texto);
    if (lido.itens.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não reconheci um pedido nessa mensagem. Cole a mensagem inteira que a cliente enviou pelo catálogo.",
        },
        { status: 422 }
      );
    }

    // PREÇO DO PEDIDO COLADO: tem que valer o MESMO que a cliente viu.
    //
    // A mensagem do catálogo carimba a tabela quando ela veio de um link de
    // preço (`_Tabela: Atacado_`). Sem ler isso, a lojista colava um pedido de
    // ATACADO e o sistema remontava tudo pelo padrão da loja — cobrando
    // R$ 89,90 de quem devia pagar R$ 45,00, sem ninguém perceber (revisão
    // 18/08/2026). O texto manda; sem carimbo, vale o padrão de sempre.
    const loja = await db.company.findUnique({
      where: { id: user.companyId },
      select: { catalogPriceMode: true, priceTablesEnabled: true },
    });
    const tabelaDaMensagem = tabelaNoTexto(parsed.data.texto);
    // DESCONTO DO LINK DE CAMPANHA (RN-040), pelo mesmo motivo da tabela
    // acima: sem ler o carimbo, o pedido que a cliente aprovou com desconto
    // era remontado a preço cheio.
    //
    // MAS O NÚMERO NÃO VEM DO TEXTO. A mensagem do wa.me é digitável: trocar
    // "(20% OFF)" por "(90% OFF)" daria 90% sobre o preço do cadastro. O
    // texto só diz QUAL campanha; o desconto sai do cadastro da loja (achado
    // da revisão de 01/09/2026). Diferente do `tabelaNoTexto`, que escolhe
    // entre dois preços que já são nossos.
    const campanhasDaLoja = await db.trackCampaign.findMany({
      where: { companyId: user.companyId, active: true, archivedAt: null },
      select: { slug: true, name: true, discount: true, active: true, archivedAt: true },
    });
    const campanhaDaMensagem = campanhaNoTexto(parsed.data.texto);
    // O nome diz QUAL campanha; a porcentagem do texto é só CONFERÊNCIA (ela
    // é digitável, então nunca decide dinheiro). Não bateu — campanha xará,
    // desconto que mudou, campanha que sumiu —, o preço é o cheio e a prévia
    // AVISA: remontar calado é o incidente "aprovou R$ 800, nasceu R$ 1.000".
    const resgate = descontoDoResgate(
      campanhaDaMensagem,
      descontoNoTexto(parsed.data.texto),
      campanhasDaLoja
    );
    // DESCONTOS NÃO SE SOMAM (RN-040), aqui também: mensagem que traz
    // `_Tabela: Atacado_` E `_Campanha: X (20% OFF)_` sairia com atacado
    // MENOS 20% — valor que nenhuma tela mostrou. Os outros dois caminhos já
    // travavam isso; este não (achado da revisão de 01/09/2026).
    const descontoDaMensagem = tabelaDaMensagem ? 0 : resgate.desconto;
    const modoPreco =
      loja?.priceTablesEnabled && tabelaDaMensagem
        ? tabelaDaMensagem
        : modoValido(loja?.catalogPriceMode);

    // catálogo da loja (só o que está à venda entra num pedido novo)
    const produtos = await db.product.findMany({
      where: { companyId: user.companyId, active: true },
      select: {
        id: true,
        name: true,
        // MESMA RÉGUA DO CATÁLOGO: o pedido colado vale o preço que a
        // vitrine cobra (decisão do dono, 05/08/2026) — hoje isso é varejo
        // ou atacado, conforme a escolha da loja em Personalizar catálogo
        retailPrice: true,
        wholesalePrice: true, // pro preço seguir a escolha do catálogo
        variants: { select: { id: true, color: true, size: true, stock: true } },
      },
    });

    type LinhaPrevia = {
      descricao: string;
      productId: string | null;
      variantId: string | null;
      nome: string | null;
      cor: string | null;
      tamanho: string;
      quantidade: number;
      unitPrice: number | null;
      estoque: number | null;
      problema: string | null;
    };

    const linhas: LinhaPrevia[] = [];
    for (const item of lido.itens) {
      // formato antigo/achatado: o item vem só com a cor ("Branco") e o nome
      // do modelo mora no título da seção — tenta primeiro como veio, depois
      // com o título na frente ("Blusa Clássica Tule Branco")
      const achado =
        separarProdutoECor(item.descricao, produtos) ??
        (item.categoria
          ? separarProdutoECor(`${item.categoria} ${item.descricao}`, produtos)
          : null);
      for (const t of item.tamanhos) {
        if (!achado) {
          linhas.push({
            descricao: item.descricao,
            productId: null,
            variantId: null,
            nome: null,
            cor: null,
            tamanho: t.tamanho,
            quantidade: t.quantidade,
            unitPrice: null,
            estoque: null,
            problema: "Produto não encontrado no catálogo",
          });
          continue;
        }
        const { produto, cor } = achado;
        // a cor pode faltar no texto: se o produto só tem uma, é ela
        const doTamanho = produto.variants.filter(
          (v) => normalizar(v.size) === normalizar(t.tamanho)
        );
        let variante = cor
          ? doTamanho.find((v) => normalizar(v.color) === normalizar(cor))
          : doTamanho.length === 1
            ? doTamanho[0]
            : undefined;
        // a cor pode vir repetida no texto (nome do produto já traz a cor):
        // tentamos as formas conhecidas antes de dar a linha como perdida
        if (!variante && cor) {
          for (const c of candidatosDeCor(cor)) {
            variante = doTamanho.find((v) => normalizar(v.color) === normalizar(c));
            if (variante) break;
          }
        }
        // produto certo, tamanho certo, e só uma cor possível: é ela
        if (!variante && doTamanho.length === 1) variante = doTamanho[0];
        linhas.push({
          descricao: item.descricao,
          productId: produto.id,
          variantId: variante?.id ?? null,
          nome: produto.name,
          cor: variante?.color ?? (cor || null),
          tamanho: t.tamanho,
          quantidade: t.quantidade,
          // PREÇO SEMPRE DO NOSSO CADASTRO — o valor do texto é só conferência
          unitPrice: precoComDesconto(catalogPrice(produto, modoPreco), descontoDaMensagem),
          estoque: variante?.stock ?? null,
          problema: variante
            ? variante.stock < t.quantidade
              ? `Estoque insuficiente (tem ${variante.stock})`
              : null
            : `Sem essa variação${cor ? ` (${cor} ${t.tamanho})` : ` (tamanho ${t.tamanho})`}`,
        });
      }
    }

    // a cliente: achada pelo telefone (tolerante ao 9º dígito, como o intake)
    let cliente: { id: string; name: string; phone: string } | null = null;
    if (lido.cliente.telefone) {
      cliente = await db.customer.findFirst({
        where: {
          companyId: user.companyId,
          phone: { in: phoneMatchVariants(lido.cliente.telefone) },
        },
        select: { id: true, name: true, phone: true },
      });
    }

    const lidas = pecasLidas(lido);
    return NextResponse.json({
      loja: lido.loja,
      cliente: {
        encontrada: cliente,
        nome: lido.cliente.nome,
        lojaDela: lido.cliente.loja,
        telefone: lido.cliente.telefone ? normalizePhone(lido.cliente.telefone) : null,
      },
      linhas,
      resumo: {
        pecasLidas: lidas,
        pecasNaMensagem: lido.totalPecas,
        // a mensagem discordar da leitura é aviso, não erro: a cliente pode
        // ter colado a mensagem pela metade
        confere: lido.totalPecas === null || lido.totalPecas === lidas,
        valorNaMensagem: lido.totalValor,
        comProblema: linhas.filter((l) => l.problema).length,
        // a prévia DIZ que aplicou o desconto do link: preço diferente do
        // cadastro sem explicação parece defeito (RN-040)
        descontoDoLink: descontoDaMensagem,
        campanhaNaMensagem: campanhaDaMensagem,
        campanhaSlug: descontoDaMensagem > 0 ? (resgate.campanha?.slug ?? null) : null,
        campanhaNaoResolvida: resgate.naoConfere,
      },
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
