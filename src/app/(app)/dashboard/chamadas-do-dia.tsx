import Link from "next/link";
import { Zap, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import type { AutomationSuggestion } from "@/lib/automations";
import { montarMensagem, CAMPO_DA_CHAMADA, tipoDaRegra } from "@/lib/mensagens-chamada";
import type { SessionUser } from "@/lib/auth";
import { QuemChamarHoje, LIMITE_CHAMADAS, type ChamadaDoDia } from "./quem-chamar-hoje";

/**
 * "QUEM CHAMAR HOJE" — carregado À PARTE do resto do Dashboard.
 *
 * Este bloco é o mais pesado da tela (o motor de sugestões varre conversas,
 * negociações, ritmo de compra e aniversários) e é o ÚNICO que não tem nada a
 * ver com o filtro de data: a lista de quem chamar é a mesma escolhendo
 * "hoje", "7 dias" ou "mês passado".
 *
 * Enquanto ele estava junto do resto, TODA troca de período esperava por ele
 * antes de desenhar qualquer coisa — a lojista tocava numa data e a tela
 * ficava parada. Agora os números do período aparecem primeiro e a lista
 * chega logo em seguida, no lugar do esqueleto.
 *
 * A BUSCA JÁ VEM COMEÇADA: a página manda a PROMESSA, não o resultado. Um
 * bloco em Suspense só começa a rodar quando o pai termina de esperar as
 * consultas dele — se este aqui chamasse o motor por conta própria, ele
 * arrancaria depois de tudo e a tela ficaria pronta MAIS TARDE do que antes,
 * mesmo aparecendo mais cedo. Começando lá, o motor trabalha ao mesmo tempo
 * que o resto e a Suspense só decide quando MOSTRAR.
 */
export async function ChamadasDoDia({
  user,
  primeiroNome,
  sugestoes,
}: {
  user: SessionUser;
  primeiroNome: string;
  /** promessa já em andamento, criada pela página */
  sugestoes: Promise<AutomationSuggestion[]>;
}) {
  const suggestions = await sugestoes;
  // SÓ AS QUE APARECEM NA TELA. A lista mostra 8 e o resto vira o link "ver
  // mais" — buscar a ficha e montar a mensagem pronta de todas (numa loja de
  // verdade passam de mil) era trabalho inteiro jogado fora.
  const naTela = suggestions.slice(0, LIMITE_CHAMADAS);

  const [fichas, textosDaLoja] = await Promise.all([
    naTela.length
      ? db.customer.findMany({
          where: {
            companyId: user.companyId,
            id: { in: [...new Set(naTela.map((s) => s.customerId))] },
          },
          select: { id: true, phone: true, owner: { select: { color: true } } },
        })
      : [],
    // texto de cada mensagem: o da LOJA quando ela personalizou, senão o padrão
    naTela.length
      ? db.commSettings.findUnique({
          where: { companyId: user.companyId },
          select: {
            msgAniversario: true,
            msgRecompra: true,
            msgPosVenda: true,
            msgPrimeiroContato: true,
            msgConversaParada: true,
          },
        })
      : null,
  ]);

  const fichaPorId = new Map(fichas.map((c) => [c.id, c]));
  const chamadas: ChamadaDoDia[] = naTela.map((s) => {
    const ficha = fichaPorId.get(s.customerId);
    const primeiro = s.customerName.split(" ")[0];
    const tipo = tipoDaRegra(s.key.split(":")[0]);
    const personalizada = textosDaLoja
      ? (textosDaLoja as Record<string, string | null>)[CAMPO_DA_CHAMADA[tipo]]
      : null;
    return {
      key: s.key,
      customerId: s.customerId,
      customerName: s.customerName,
      phone: ficha?.phone ?? "",
      motivo: s.description,
      mensagem: montarMensagem(tipo, { nome: primeiro }, personalizada),
      tipo,
      ownerColor: ficha?.owner?.color ?? "#c4622d",
    };
  });

  return (
    <>
      <QuemChamarHoje
        chamadas={chamadas}
        total={suggestions.length}
        primeiroNome={primeiroNome}
      />
      {suggestions.length > 0 && (
        <Link
          href="/automacoes"
          className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 mb-6 hover:bg-brand-100 transition group"
        >
          <Zap className="size-5 text-brand-600 shrink-0" />
          <p className="text-sm text-brand-800 flex-1">
            <span className="font-semibold">
              {suggestions.length}{" "}
              {suggestions.length === 1 ? "sugestão" : "sugestões"} de automação
            </span>{" "}
            — follow-ups, recompras e reativações esperando ação.
          </p>
          <ChevronRight className="size-4 text-brand-400 group-hover:translate-x-0.5 transition" />
        </Link>
      )}
    </>
  );
}

/** Esqueleto do bloco enquanto o motor de sugestões trabalha. */
export function ChamadasDoDiaEsqueleto() {
  return (
    <div
      className="rounded-2xl border border-brand-200 bg-white overflow-hidden mb-6"
      aria-busy="true"
      aria-label="Carregando quem chamar hoje"
    >
      <div className="px-4 py-3 bg-brand-50 border-b border-brand-100">
        <div className="skeleton h-4 w-64 rounded" />
        <div className="skeleton h-3 w-48 rounded mt-2" />
      </div>
      <ul className="divide-y divide-gray-50">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="skeleton size-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-1/2 rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
