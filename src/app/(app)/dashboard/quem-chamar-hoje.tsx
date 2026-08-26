import Link from "next/link";
import { Cake, Repeat, MessageCircle, PackageCheck, UserPlus, ChevronRight } from "lucide-react";
import { Avatar } from "@/components/ui";

/**
 * QUEM CHAMAR HOJE — a lista que transforma o CRM em dinheiro.
 *
 * O sistema já sabia tudo isso (aniversário, ritmo de compra quebrado,
 * conversa parada, pós-venda), mas a informação ficava enterrada numa tela
 * lateral que ninguém abria. Aqui ela é a PRIMEIRA coisa que a lojista vê,
 * com o motivo escrito em português e a mensagem já pronta: um toque abre o
 * WhatsApp com o texto digitado.
 *
 * A diferença entre "sistema que eu preciso alimentar" e "lista que me dá
 * dinheiro" é exatamente esta tela.
 */

/**
 * Quantas chamadas a lista desenha. Vale também no servidor: é o que ele usa
 * para montar SÓ estas fichas e mensagens, em vez de todas (a loja de verdade
 * tem mais de mil sugestões e a tela sempre mostrou 8).
 */
export const LIMITE_CHAMADAS = 8;

export type ChamadaDoDia = {
  key: string;
  customerId: string;
  customerName: string;
  phone: string;
  /** por que ela está na lista, em uma linha */
  motivo: string;
  /** mensagem sugerida, já pronta para enviar */
  mensagem: string;
  tipo: "ANIVERSARIO" | "RECOMPRA" | "PARADA" | "POS_VENDA" | "NOVA";
  ownerColor: string;
};

const ESTILO = {
  ANIVERSARIO: { Icon: Cake, cor: "bg-pink-100 text-pink-600", rotulo: "Aniversário" },
  RECOMPRA: { Icon: Repeat, cor: "bg-amber-100 text-amber-600", rotulo: "Recompra" },
  PARADA: { Icon: MessageCircle, cor: "bg-sky-100 text-sky-600", rotulo: "Conversa parada" },
  POS_VENDA: { Icon: PackageCheck, cor: "bg-emerald-100 text-emerald-600", rotulo: "Pós-venda" },
  NOVA: { Icon: UserPlus, cor: "bg-violet-100 text-violet-600", rotulo: "Cliente nova" },
} as const;

/** Link do WhatsApp com a mensagem já escrita. */
function waHref(phone: string, msg: string): string | null {
  const d = phone.replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.length <= 11 ? "55" + d : d}?text=${encodeURIComponent(msg)}`;
}

export function QuemChamarHoje({
  chamadas,
  total,
  primeiroNome,
}: {
  /** só as que aparecem (no máximo LIMITE_CHAMADAS) */
  chamadas: ChamadaDoDia[];
  /** quantas existem no total — é o número do cabeçalho e do "ver mais" */
  total: number;
  primeiroNome: string;
}) {
  if (total === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 mb-6">
        <p className="text-sm font-semibold text-emerald-800">
          Tudo em dia por aqui, {primeiroNome} 🎉
        </p>
        <p className="text-xs text-emerald-700/70">
          Nenhuma cliente esperando contato hoje.
        </p>
      </div>
    );
  }

  const mostrar = chamadas.slice(0, LIMITE_CHAMADAS);
  const resto = total - mostrar.length;

  return (
    <div className="rounded-2xl border border-brand-200 bg-white overflow-hidden mb-6">
      <div className="px-4 py-3 bg-brand-50 border-b border-brand-100">
        <p className="text-sm font-semibold text-brand-800">
          ☀️ Bom dia, {primeiroNome}! Hoje você tem{" "}
          {total === 1 ? "1 cliente para chamar" : `${total} clientes para chamar`}
        </p>
        <p className="text-xs text-brand-700/70">
          Toque em uma para abrir o WhatsApp com a mensagem pronta.
        </p>
      </div>

      <ul className="divide-y divide-gray-50">
        {mostrar.map((c) => {
          const { Icon, cor, rotulo } = ESTILO[c.tipo];
          const href = waHref(c.phone, c.mensagem);
          const Conteudo = (
            <>
              <Avatar name={c.customerName} color={c.ownerColor} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">
                    {c.customerName}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cor}`}
                  >
                    <Icon className="size-3" />
                    {rotulo}
                  </span>
                </span>
                <span className="block text-xs text-gray-400 truncate">
                  {c.motivo}
                </span>
              </span>
              <ChevronRight className="shrink-0 size-4 text-gray-300" />
            </>
          );
          return (
            <li key={c.key}>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                >
                  {Conteudo}
                </a>
              ) : (
                // sem telefone válido: leva para a ficha, onde dá para corrigir
                <Link
                  href={`/clientes/${c.customerId}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition"
                >
                  {Conteudo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {resto > 0 && (
        <Link
          href="/tarefas"
          className="flex items-center justify-center gap-1 px-4 py-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50 border-t border-gray-50 transition"
        >
          Ver mais {resto} {resto === 1 ? "cliente" : "clientes"}
          <ChevronRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
