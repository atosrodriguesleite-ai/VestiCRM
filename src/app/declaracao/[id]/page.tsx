import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { orderNumber } from "@/lib/orders";
import { brl, dateFull } from "@/lib/format";
import { PrintButton } from "./print-button";

/**
 * Declaração de Conteúdo (modelo dos Correios) — para envio SEM nota fiscal.
 * Página imprimível em A4: remetente (Configurações → Melhor Envio),
 * destinatário (ficha do cliente) e itens do pedido.
 */
export default async function DeclaracaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const [order, conn, company] = await Promise.all([
    db.order.findFirst({
      where: { id, companyId: user.companyId },
      include: { customer: true, items: true },
    }),
    db.melhorEnvioConnection.findUnique({ where: { companyId: user.companyId } }),
    db.company.findUnique({
      where: { id: user.companyId },
      select: { shippingEnabled: true, name: true },
    }),
  ]);
  if (!order || !company?.shippingEnabled) notFound();

  const c = order.customer;
  const remetente = {
    nome: conn?.fromName ?? company.name,
    doc: conn?.fromDocument ?? "",
    endereco: [
      conn?.fromStreet,
      conn?.fromNumber,
      conn?.fromComplement,
      conn?.fromDistrict,
    ]
      .filter(Boolean)
      .join(", "),
    cidadeUf: [conn?.fromCity, conn?.fromState].filter(Boolean).join(" / "),
    cep: conn?.fromZip ?? "",
  };
  const destinatario = {
    nome: c.name,
    doc: c.document ?? "",
    endereco: [c.street, c.streetNumber, c.complement, c.district]
      .filter(Boolean)
      .join(", "),
    cidadeUf: [c.city, c.state].filter(Boolean).join(" / "),
    cep: c.zip ?? "",
  };
  const totalItens = order.items.reduce((s, i) => s + i.quantity, 0);
  const totalValor = order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const th = "border border-gray-800 px-2 py-1.5 text-left text-[11px] font-bold uppercase";
  const td = "border border-gray-800 px-2 py-1.5 text-[12px]";

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-gray-900 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-gray-500">
          Pedido {orderNumber(order.number)} — confira os dados e imprima em A4.
        </p>
        <PrintButton />
      </div>

      <h1 className="text-center text-lg font-bold uppercase tracking-wide mb-4">
        Declaração de Conteúdo
      </h1>

      <div className="grid grid-cols-2 gap-0 mb-4">
        <div className="border border-gray-800 p-3">
          <p className="text-[11px] font-bold uppercase mb-1">Remetente</p>
          <p className="text-[12px]"><b>Nome:</b> {remetente.nome}</p>
          {remetente.doc && <p className="text-[12px]"><b>CPF/CNPJ:</b> {remetente.doc}</p>}
          <p className="text-[12px]"><b>Endereço:</b> {remetente.endereco}</p>
          <p className="text-[12px]"><b>Cidade/UF:</b> {remetente.cidadeUf}</p>
          <p className="text-[12px]"><b>CEP:</b> {remetente.cep}</p>
        </div>
        <div className="border border-l-0 border-gray-800 p-3">
          <p className="text-[11px] font-bold uppercase mb-1">Destinatário</p>
          <p className="text-[12px]"><b>Nome:</b> {destinatario.nome}</p>
          {destinatario.doc && <p className="text-[12px]"><b>CPF/CNPJ:</b> {destinatario.doc}</p>}
          <p className="text-[12px]"><b>Endereço:</b> {destinatario.endereco}</p>
          <p className="text-[12px]"><b>Cidade/UF:</b> {destinatario.cidadeUf}</p>
          <p className="text-[12px]"><b>CEP:</b> {destinatario.cep}</p>
        </div>
      </div>

      <table className="w-full border-collapse mb-1">
        <thead>
          <tr>
            <th className={`${th} w-12`}>Item</th>
            <th className={th}>Conteúdo</th>
            <th className={`${th} w-16 text-center`}>Qtd.</th>
            <th className={`${th} w-28 text-right`}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i, idx) => (
            <tr key={i.id}>
              <td className={`${td} text-center`}>{idx + 1}</td>
              <td className={td}>
                {i.name}
                {[i.color, i.size].filter(Boolean).length > 0 &&
                  ` (${[i.color, i.size].filter(Boolean).join(" · ")})`}
              </td>
              <td className={`${td} text-center`}>{i.quantity}</td>
              <td className={`${td} text-right tabular-nums`}>
                {brl(i.quantity * i.unitPrice)}
              </td>
            </tr>
          ))}
          <tr>
            <td className={`${td} font-bold`} colSpan={2}>Totais</td>
            <td className={`${td} text-center font-bold`}>{totalItens}</td>
            <td className={`${td} text-right font-bold tabular-nums`}>{brl(totalValor)}</td>
          </tr>
        </tbody>
      </table>

      <p className="text-[11px] leading-relaxed border border-gray-800 p-3 mb-6">
        <b>DECLARAÇÃO:</b> Declaro que não me enquadro no conceito de
        contribuinte previsto no art. 4º da Lei Complementar nº 87/1996, uma vez
        que não realizo, com habitualidade ou em volume que caracterize intuito
        comercial, operações de circulação de mercadoria, ainda que se iniciem
        no exterior, ou estou dispensado da emissão da nota fiscal por força da
        legislação tributária vigente, responsabilizando-me, nos termos da lei
        e a quem de direito, por informações inverídicas.
      </p>

      <div className="grid grid-cols-2 gap-8 text-[12px]">
        <p>
          ______________________________, ______ de ____________________ de {new Date().getFullYear()}
        </p>
        <div>
          <p className="border-t border-gray-800 pt-1 text-center">
            Assinatura do remetente
          </p>
        </div>
      </div>

      <p className="mt-6 text-[10px] text-gray-500">
        Pedido {orderNumber(order.number)} · emitido em {dateFull(new Date())} ·
        AtacadoPro
      </p>
    </div>
  );
}
