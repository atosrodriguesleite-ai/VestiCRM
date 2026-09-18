import { porteiraEtiquetasTela } from "@/lib/etiquetas/gate";

/**
 * Módulo Etiquetas (RN-059): sem a chave `etiquetasEnabled` ligada pelo Super
 * Admin, a loja nem vê esta tela — a porteira devolve ao Dashboard. Toda a
 * equipe entra (imprimir e separar é operação de quem está na arara).
 */
export default async function EtiquetasLayout({ children }: { children: React.ReactNode }) {
  await porteiraEtiquetasTela();
  return <div className="max-w-7xl mx-auto">{children}</div>;
}
