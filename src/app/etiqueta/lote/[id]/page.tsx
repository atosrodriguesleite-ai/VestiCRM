import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PrintBar } from "./print-bar";

/**
 * Etiqueta/romaneio do lote de costura — página limpa pra impressão.
 * ?f=termica → formato 10×15 cm (impressora de etiqueta); padrão A4.
 * O QR aponta pra conferência do lote no sistema.
 */
export default async function EtiquetaLotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ f?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const { f } = await searchParams;
  const termica = f === "termica";

  const batch = await db.sewingBatch.findFirst({
    where: { id, companyId: user.companyId },
    include: { items: true, faction: true },
  });
  if (!batch) redirect("/producao/lotes");
  const company = await db.company.findUnique({ where: { id: user.companyId } });

  const codigo = `L-${String(batch.code).padStart(6, "0")}`;
  const total = batch.items.reduce((a, i) => a + i.sent, 0);
  const base = process.env.APP_URL ?? "https://www.atacadopro.com";
  const qrUrl = `/api/qrcode?url=${encodeURIComponent(`${base}/producao/lotes?lote=${batch.code}`)}`;

  return (
    <div
      className={termica ? "mx-auto p-3" : "mx-auto p-8 max-w-[700px]"}
      style={termica ? { width: "10cm", minHeight: "15cm" } : undefined}
    >
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { size: ${termica ? "10cm 15cm" : "A4"}; margin: ${termica ? "0.3cm" : "1.5cm"}; }
        }
      `}</style>
      <PrintBar termica={termica} id={batch.id} />

      <div className={`border-2 border-black ${termica ? "p-3" : "p-6"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-bold ${termica ? "text-xl" : "text-3xl"} leading-none`}>{codigo}</p>
            <p className={`${termica ? "text-[10px]" : "text-sm"} text-gray-600 mt-1`}>
              {company?.name} · lote de {batch.kind === "CONSERTO" ? "CONSERTO" : "costura"}
            </p>
            <p className={`${termica ? "text-[11px]" : "text-base"} font-semibold mt-1.5`}>
              Destino: {batch.destination === "FACCAO" ? `Facção ${batch.faction?.name ?? ""}` : "Costura interna"}
            </p>
            <p className={`${termica ? "text-[10px]" : "text-sm"} text-gray-600`}>
              Enviado em {batch.sentAt.toLocaleDateString("pt-BR")}
            </p>
          </div>
          {/* QR abre a conferência do lote no sistema */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="QR do lote" className={termica ? "size-16" : "size-24"} />
        </div>

        <table className={`w-full mt-3 border-collapse ${termica ? "text-[10px]" : "text-sm"}`}>
          <thead>
            <tr className="border-y border-black text-left">
              <th className="py-1">Modelo</th>
              <th className="py-1">Cor</th>
              <th className="py-1">Tam</th>
              <th className="py-1 text-right">Qtd</th>
            </tr>
          </thead>
          <tbody>
            {batch.items.map((i) => (
              <tr key={i.id} className="border-b border-gray-300">
                <td className="py-1 font-medium">{i.productName}</td>
                <td className="py-1">{i.color ?? "—"}</td>
                <td className="py-1">{i.size ?? "—"}</td>
                <td className="py-1 text-right font-bold tabular-nums">{i.sent}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className={`mt-2 text-right font-bold ${termica ? "text-base" : "text-2xl"}`}>
          TOTAL: {total} peça{total === 1 ? "" : "s"}
        </p>

        {batch.notes && (
          <p className={`${termica ? "text-[10px]" : "text-sm"} text-gray-600 mt-1`}>Obs.: {batch.notes}</p>
        )}

        <div className={`mt-${termica ? "4" : "10"} pt-3 grid grid-cols-2 gap-6 ${termica ? "text-[10px]" : "text-sm"}`}>
          <div className="border-t border-black pt-1 text-center">Quem enviou</div>
          <div className="border-t border-black pt-1 text-center">Quem recebeu ({total} peças)</div>
        </div>
      </div>
    </div>
  );
}
