import { PaginaMovimentacoes } from "../_mov/pagina";

export const dynamic = "force-dynamic";

/** Contas a Receber (RN-030) — o que a loja tem para receber. */
export default async function ContasAReceberPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PaginaMovimentacoes tipo="RECEITA" searchParams={searchParams} />;
}
