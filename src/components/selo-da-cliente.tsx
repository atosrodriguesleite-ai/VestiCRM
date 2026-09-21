"use client";

import { Repeat, ShoppingBag, BadgeCheck } from "lucide-react";
import {
  explicacaoDoSelo,
  rotuloDoSelo,
  type SeloInfo,
} from "@/lib/selo-da-cliente";

/**
 * O SELO DA CLIENTE (RN-063), desenhado de propósito DIFERENTE das
 * etiquetas manuais: selo cheio, com ícone e sem o "×" de remover — ele é
 * calculado dos pedidos e ninguém tira na mão. Amarelo = tem pedido, ainda
 * não pagou; verde = já comprou; verde com as setinhas = recompra.
 */
export function SeloDaClientePill({
  info,
  tamanho = "sm",
}: {
  info: SeloInfo;
  tamanho?: "sm" | "md";
}) {
  if (!info.selo) return null;
  const base =
    tamanho === "md"
      ? "text-[11px] px-2 py-0.5 gap-1"
      : "text-[10px] px-1.5 py-0.5 gap-0.5";
  const icone = tamanho === "md" ? "size-3" : "size-2.5";
  const cor =
    info.selo === "PEDIDO"
      ? "bg-amber-100 text-amber-800 ring-amber-200"
      : "bg-emerald-100 text-emerald-800 ring-emerald-200";
  return (
    <span
      data-selo={info.selo}
      title={explicacaoDoSelo(info)}
      className={`inline-flex items-center rounded-full font-bold ring-1 ring-inset shrink-0 ${base} ${cor}`}
    >
      {info.selo === "PEDIDO" ? (
        <ShoppingBag className={icone} />
      ) : (
        <BadgeCheck className={icone} />
      )}
      {rotuloDoSelo(info)}
      {info.selo === "RECOMPRA" && (
        // as setinhas da recompra — o símbolo que o dono pediu
        <Repeat className={`${icone} ml-0.5`} aria-label="recompra" />
      )}
    </span>
  );
}
