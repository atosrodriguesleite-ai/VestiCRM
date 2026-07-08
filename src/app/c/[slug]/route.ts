import { NextRequest, NextResponse } from "next/server";

/**
 * Link curto dos vendedores e campanhas:
 *   vesticrm.com/c/bella-moda?ref=julia → /catalogo/bella-moda?ref=julia
 * Preserva ?ref= e UTMs para a Tracking Engine atribuir o acesso.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = req.nextUrl.clone();
  url.pathname = `/catalogo/${slug}`;
  return NextResponse.redirect(url, 308);
}
