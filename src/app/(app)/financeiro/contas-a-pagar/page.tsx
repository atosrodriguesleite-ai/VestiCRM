import { PaginaMovimentacoes } from "../_mov/pagina";

export const dynamic = "force-dynamic";

/** Contas a Pagar (RN-030) — o que a loja tem para pagar. */
export default async function ContasAPagarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PaginaMovimentacoes tipo="DESPESA" searchParams={searchParams} />;
}
