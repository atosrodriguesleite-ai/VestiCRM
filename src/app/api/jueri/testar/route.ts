import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/scope";

/**
 * Teste de LEITURA da integração Jueri — Super Admin only.
 *
 * Recebe o token e o ID do cliente no sistema Jueri, faz apenas GETs
 * (nada é criado ou alterado lá) e devolve um relatório do que a API
 * entrega: tipos de preço, categorias, amostra de produtos e — o ponto
 * que só o teste real responde — se a consulta de produto traz FOTO.
 *
 * O token viaja só nesta requisição e NÃO é gravado em lugar nenhum.
 */

const schema = z.object({
  token: z.string().min(10),
  clienteSistema: z.string().min(1).max(20),
});

const BASE = "https://jueri.com.br/sis/api/v1";

async function jueriGet(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    // leitura pontual: sem cache
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* resposta sem JSON */
  }
  return { status: res.status, body };
}

/** Procura recursivamente um campo que pareça ser foto/imagem. */
function achaFoto(obj: unknown, profundidade = 0): string | null {
  if (!obj || typeof obj !== "object" || profundidade > 3) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const chave = k.toLowerCase();
    if (
      (chave.includes("imagem") || chave.includes("foto") || chave.includes("image")) &&
      typeof v === "string" &&
      v.length > 4
    ) {
      return `${k}: ${v.slice(0, 120)}`;
    }
    if (typeof v === "object" && v !== null) {
      const achado = achaFoto(v, profundidade + 1);
      if (achado) return achado;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!isSuperAdmin(user)) {
      return NextResponse.json({ error: "Só o Super Admin pode rodar este teste." }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Informe o token e o ID do cliente." }, { status: 400 });
    }
    const { token, clienteSistema } = parsed.data;
    const p = (rota: string) => `/${clienteSistema}${rota}`;

    // 1) conexão/autenticação
    const status = await jueriGet(token, p("/status"));
    const autenticou = status.status !== 401;

    // 2) tipos de preço (Varejo/Atacado)
    const tipoPreco = await jueriGet(token, p("/tipo-preco"));

    // 3) categorias
    const categorias = await jueriGet(token, p("/produto/categoria"));

    // 4) amostra de produtos
    const lista = await jueriGet(token, p("/produto?per_page=5"));
    const listaBody = lista.body as { data?: Record<string, unknown>[]; total?: number } | null;
    const amostra = Array.isArray(listaBody?.data) ? listaBody!.data! : [];

    // 5) detalhe do primeiro produto (lista completa de campos + foto?)
    let detalhe: { status: number; body: unknown } | null = null;
    let campos: string[] = [];
    let foto: string | null = null;
    const primeiroId = amostra[0]?.id;
    if (primeiroId != null) {
      detalhe = await jueriGet(token, p(`/produto/${primeiroId}`));
      if (detalhe.body && typeof detalhe.body === "object") {
        campos = Object.keys(detalhe.body as object);
        foto = achaFoto(detalhe.body);
      }
    }
    if (!foto) foto = achaFoto(amostra[0] ?? null);

    return NextResponse.json({
      conexao: { httpStatus: status.status, autenticou },
      tiposPreco: tipoPreco.body ?? tipoPreco.status,
      categorias: Array.isArray(categorias.body)
        ? categorias.body
        : categorias.status,
      totalProdutosPagina: amostra.length,
      amostraProdutos: amostra.map((prod) => ({
        id: prod.id,
        descricao: prod.descricao,
        referencia: prod.referencia,
        codigo_barras: prod.codigo_barras,
        cor: prod.cor,
        quantidade: prod.quantidade,
        tipo_preco: prod.tipo_preco,
      })),
      camposDoProdutoDetalhado: campos,
      fotoEncontrada: foto,
      produtoDetalhadoBruto: detalhe?.body ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    const msg = e instanceof Error ? e.message : "Falha ao consultar a Jueri";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
