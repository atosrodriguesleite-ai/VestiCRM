import { porteiraEstoqueTela } from "@/lib/estoque/gate";

/**
 * Módulo Estoque (RN-050): sem a chave `estoqueEnabled` ligada pelo Super
 * Admin, a loja nem vê esta tela — a porteira devolve ao Dashboard. Toda a
 * equipe entra (conferir estoque é operação); ajustar é gerência, e isso a
 * porta de escrita confere de novo.
 */
export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  await porteiraEstoqueTela();
  return <div className="max-w-7xl mx-auto">{children}</div>;
}
