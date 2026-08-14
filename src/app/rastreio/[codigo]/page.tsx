import type { Metadata } from "next";
import { Package, Truck, CheckCircle2, Clock, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { orderNumber } from "@/lib/orders";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Acompanhe seu pedido",
  // página de uso pessoal da cliente: não interessa a buscador
  robots: { index: false, follow: false },
};

/**
 * PÁGINA PÚBLICA DE RASTREIO — o link que a vendedora manda no WhatsApp.
 *
 * A cliente clica e vê, sem login e sem instalar nada, em que pé está a
 * entrega. Mostra SÓ o necessário (loja, número do pedido, primeiro nome,
 * situação, código e data): o endereço, os valores e os dados da ficha
 * NUNCA aparecem aqui — o link circula em conversa de WhatsApp e pode ser
 * repassado. O código é sorteado (não é o id do pedido), então ninguém
 * "adivinha" o rastreio do vizinho trocando um número na URL.
 */

const PASSOS = [
  { chave: "ETIQUETA", titulo: "Pedido embalado", texto: "A loja preparou seu pacote e gerou a etiqueta." },
  { chave: "POSTADO", titulo: "A caminho", texto: "O pacote saiu da loja e está com a transportadora." },
  { chave: "ENTREGUE", titulo: "Entregue", texto: "O pacote chegou no endereço de entrega." },
] as const;

function indiceDoPasso(meStatus: string | null): number {
  if (meStatus === "ENTREGUE") return 2;
  if (meStatus === "POSTADO") return 1;
  return 0;
}

const dataBr = (d: Date | null) =>
  d
    ? d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        timeZone: "America/Sao_Paulo",
      })
    : null;

export default async function RastreioPublicoPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const envio = await db.shipping.findUnique({
    where: { publicCode: codigo },
    select: {
      meStatus: true,
      meCarrier: true,
      meService: true,
      trackingCode: true,
      shippedAt: true,
      deliveredAt: true,
      order: {
        select: {
          number: true,
          status: true,
          customer: { select: { name: true } },
          company: { select: { name: true } },
        },
      },
    },
  });

  if (!envio || envio.meStatus === "CANCELADO" || envio.order.status === "CANCELADO") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <Package className="mx-auto mb-4 size-14 text-gray-300" />
          <h1 className="mb-2 text-xl font-bold">Rastreio não encontrado</h1>
          <p className="text-sm text-gray-500">
            Esse link não está mais valendo. Chame a loja no WhatsApp que ela
            te passa a situação do pedido. 💛
          </p>
        </div>
      </main>
    );
  }

  const passoAtual = indiceDoPasso(envio.meStatus);
  const primeiroNome = envio.order.customer.name.split(" ")[0];
  const datas = [null, dataBr(envio.shippedAt), dataBr(envio.deliveredAt)];

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {envio.order.company.name}
          </p>
          <h1 className="mt-1 text-xl font-bold text-gray-900">
            Oi, {primeiroNome}! Seu pedido {orderNumber(envio.order.number)}
          </h1>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          {/* situação em destaque */}
          <div
            className={`mb-6 flex items-center gap-3 rounded-xl px-4 py-3 ${
              passoAtual === 2
                ? "bg-emerald-50 text-emerald-700"
                : passoAtual === 1
                  ? "bg-sky-50 text-sky-700"
                  : "bg-amber-50 text-amber-700"
            }`}
          >
            {passoAtual === 2 ? (
              <CheckCircle2 className="size-6 shrink-0" />
            ) : passoAtual === 1 ? (
              <Truck className="size-6 shrink-0" />
            ) : (
              <Clock className="size-6 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">{PASSOS[passoAtual].titulo}</p>
              <p className="text-sm opacity-80">{PASSOS[passoAtual].texto}</p>
            </div>
          </div>

          {/* linha do tempo */}
          <ol className="space-y-4">
            {PASSOS.map((p, i) => {
              const feito = i <= passoAtual;
              return (
                <li key={p.chave} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                        feito ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {i < PASSOS.length - 1 && (
                      <span
                        className={`mt-1 w-0.5 flex-1 ${i < passoAtual ? "bg-brand-600" : "bg-gray-100"}`}
                      />
                    )}
                  </div>
                  <div className="pb-1">
                    <p className={`text-sm font-medium ${feito ? "text-gray-900" : "text-gray-400"}`}>
                      {p.titulo}
                    </p>
                    {datas[i] && feito && (
                      <p className="text-xs text-gray-500">em {datas[i]}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* código dos Correios/transportadora, para quem quiser conferir lá */}
          {envio.trackingCode && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <p className="mb-1 text-xs font-medium text-gray-400">
                Código de rastreio {envio.meCarrier ? `· ${envio.meCarrier}` : ""}
                {envio.meService ? ` ${envio.meService}` : ""}
              </p>
              <p className="font-mono text-sm font-semibold tracking-wide text-gray-800">
                {envio.trackingCode}
              </p>
              <a
                href={`https://melhorrastreio.com.br/rastreio/${envio.trackingCode}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
              >
                <MapPin className="size-4" />
                Ver detalhes na transportadora
              </a>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">
          Dúvidas? É só responder a conversa no WhatsApp da loja. 💛
        </p>
      </div>
    </main>
  );
}
