import { porteiraEtiquetasTela } from "@/lib/etiquetas/gate";

/**
 * Área SEPARAÇÃO (RN-060): a fila de pedidos pagos e o bipe com o leitor.
 * Item próprio no menu (pedido do dono, 19/09/2026: "para facilitar, a
 * tela de separação deveria ficar separada") — quem separa é quem está na
 * arara e não passa por Modelos/Imprimir. A chave é a do módulo Etiquetas
 * (mesma porteira): sem ela, volta ao Dashboard. Toda a equipe entra.
 */
export default async function SeparacaoLayout({ children }: { children: React.ReactNode }) {
  await porteiraEtiquetasTela();
  return <div className="max-w-5xl mx-auto">{children}</div>;
}
