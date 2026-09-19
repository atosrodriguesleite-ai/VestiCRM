import { redirect } from "next/navigation";

/** Endereço antigo da tela do bipe (aba aberta na bancada, favorito): leva para a área própria. */
export default async function SepararAntigoPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/separacao/${encodeURIComponent(orderId)}`);
}
