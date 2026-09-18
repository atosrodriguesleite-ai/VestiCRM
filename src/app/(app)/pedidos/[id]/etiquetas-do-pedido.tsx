"use client";

import { useState } from "react";
import Link from "next/link";
import { ScanBarcode, Tag } from "lucide-react";
import { ImprimirEtiquetas, type ItemParaEtiqueta } from "@/components/imprimir-etiquetas";

/**
 * ETIQUETAS SÓ DAS PEÇAS DESTE PEDIDO (RN-059): a quantidade de cada linha
 * já vem do pedido — é o que a lojista cola na embalagem antes de separar
 * e o que o leitor vai bipar. Com `separar`, o botão "Separar com leitor"
 * leva à tela do bipe (RN-060) — só para pedido pago ainda na loja.
 */
export function EtiquetasDoPedido({ numero, itens, separar }: { numero: string; itens: ItemParaEtiqueta[]; separar?: string | null }) {
  const [aberto, setAberto] = useState(false);
  if (itens.length === 0) return null;
  return (
    <>
      {separar && (
        <Link
          href={separar}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
        >
          <ScanBarcode className="size-4 text-brand-600" />
          Separar com leitor
        </Link>
      )}
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 hover:border-brand-300 text-gray-600 text-sm font-medium px-4 py-2.5 transition"
      >
        <Tag className="size-4 text-brand-600" />
        Etiquetas das peças
      </button>
      {aberto && (
        <ImprimirEtiquetas titulo={`Pedido ${numero}`} itens={itens} onClose={() => setAberto(false)} />
      )}
    </>
  );
}
