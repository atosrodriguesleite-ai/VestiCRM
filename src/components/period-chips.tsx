"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

/**
 * ATALHOS DE PERÍODO (Hoje · 7 dias · 30 dias · Este mês · Mês passado) e o
 * período personalizado De/Até.
 *
 * POR QUE ISTO RODA NO NAVEGADOR (25/08/2026, reclamação da Nívia: "clico nas
 * datas e trava o sistema, demora demais mudar"):
 *
 * Trocar o período é uma navegação para a MESMA tela, mudando só o que vem
 * depois do "?". Nesse caso o Next NÃO mostra o esqueleto de carregamento —
 * ele existe (`(app)/loading.tsx`) e aparece quando se troca de aba, mas não
 * quando só o filtro muda. Resultado: a lojista tocava na data e a tela
 * ficava PARADA, do jeitinho que estava, por vários segundos. Não tinha
 * travado: estava trabalhando, sem avisar. Sem resposta na tela, ela tocava
 * de novo — e cada toque era uma nova rodada de contas no servidor.
 *
 * Agora o toque responde na hora: o atalho escolhido acende e aparece
 * "Atualizando…".
 *
 * O QUE MANDA É A URL, sempre. O toque só "adianta" o desenho enquanto a
 * resposta não chega; assim que ela chega (ou quando a pessoa usa o VOLTAR do
 * navegador), o que vale é `de`/`ate` — senão a tela mostraria os números de
 * um período com o atalho de outro aceso.
 *
 * Os atalhos continuam sendo LINKS de verdade e o formulário continua sendo
 * um formulário de verdade (com `action` e `name`): antes do JavaScript
 * carregar — justamente nesta tela, que é pesada — eles ainda funcionam.
 *
 * `extra` guarda os outros filtros da tela (ex.: o canal no Marketing) para
 * que trocar o período não jogue fora o que ela já tinha escolhido.
 */
export function PeriodChips({
  pathname,
  de,
  ate,
  allLabel,
  extra,
}: {
  pathname: string;
  de?: string;
  ate?: string;
  allLabel?: string;
  extra?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [enviando, startTransition] = useTransition();
  // qual atalho a pessoa acabou de tocar (acende antes da resposta chegar)
  const [tocado, setTocado] = useState<string | null>(null);
  const [campos, setCampos] = useState({ de: de ?? "", ate: ate ?? "" });
  // DE ONDE VEIO O QUE ESTÁ NA TELA: quando a URL muda (a resposta chegou, ou
  // a pessoa usou o Voltar), o toque adiantado perde a validade e os campos
  // De/Até voltam a espelhar o período de verdade.
  const [urlNaTela, setUrlNaTela] = useState({ de, ate });
  if (urlNaTela.de !== de || urlNaTela.ate !== ate) {
    setUrlNaTela({ de, ate });
    setTocado(null);
    setCampos({ de: de ?? "", ate: ate ?? "" });
  }

  const SP_OFFSET = 3 * 60 * 60 * 1000;
  const DAY = 86_400_000;
  const agora = new Date(Date.now() - SP_OFFSET); // getters UTC = calendário SP
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const hoje = iso(agora);
  const atras = (dias: number) => iso(new Date(agora.getTime() - dias * DAY));
  const inicioMes = iso(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)));
  const inicioMesPassado = iso(
    new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1))
  );
  const fimMesPassado = iso(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 0)));

  const chips: { label: string; de?: string; ate?: string; padrao?: boolean }[] = [
    ...(allLabel ? [{ label: allLabel, padrao: true }] : []),
    { label: "Hoje", de: hoje, ate: hoje },
    { label: "7 dias", de: atras(6), ate: hoje },
    { label: "30 dias", de: atras(29), ate: hoje, padrao: !allLabel },
    { label: "Este mês", de: inicioMes, ate: hoje },
    { label: "Mês passado", de: inicioMesPassado, ate: fimMesPassado },
  ];

  // outros filtros da tela viajam junto (senão trocar o período os apagava)
  const outros = Object.entries(extra ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
  const comOutros = (params: string[]) => {
    const todos = [...params, ...outros];
    return todos.length ? `${pathname}?${todos.join("&")}` : pathname;
  };

  const ativoPelaUrl = (c: { de?: string; ate?: string; padrao?: boolean }) =>
    (Boolean(c.padrao) && !de && !ate) || (Boolean(c.de) && c.de === de && c.ate === ate);
  // um atalho está marcado? se não, e há datas, o período é personalizado
  const personalizado = !chips.some(ativoPelaUrl) && Boolean(de || ate);
  const atualizando = enviando || tocado !== null;
  // enquanto a resposta não chega vale o toque; depois, vale a URL
  const aceso = (c: { label: string; de?: string; ate?: string; padrao?: boolean }) =>
    tocado !== null ? tocado === c.label : ativoPelaUrl(c);

  return (
    <div className={`flex flex-col gap-2 ${atualizando ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chips.map((c) => {
          const href =
            c.padrao || !c.de ? comOutros([]) : comOutros([`de=${c.de}`, `ate=${c.ate}`]);
          return (
            <Link
              key={c.label}
              href={href}
              // tocar no que JÁ está aceso não muda a URL — marcar aqui
              // deixaria o "Atualizando…" preso na tela para sempre
              onClick={() => !ativoPelaUrl(c) && setTocado(c.label)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
                aceso(c)
                  ? "bg-brand-600 border-brand-600 text-white shadow-sm"
                  : "bg-white border-gray-200 text-gray-500 hover:border-brand-300 hover:text-brand-700"
              }`}
            >
              {c.label}
            </Link>
          );
        })}
        {(tocado !== null ? tocado === "Personalizado" : personalizado) && (
          <span className="rounded-full px-3 py-1.5 text-xs font-medium border bg-brand-600 border-brand-600 text-white shadow-sm">
            Personalizado
          </span>
        )}
        {/* A RESPOSTA QUE FALTAVA: sem isto a tela ficava idêntica enquanto o
            servidor refazia as contas, e parecia travada. */}
        {atualizando && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700">
            <Loader2 className="size-3.5 animate-spin" />
            Atualizando…
          </span>
        )}
      </div>

      {/* PERÍODO PERSONALIZADO: a lojista escolhe o começo e o fim.
          Continua sendo um formulário GET de verdade — sem JavaScript ele
          ainda filtra. Com JavaScript, o `onSubmit` assume para poder
          mostrar o "Atualizando…". */}
      <form
        method="GET"
        action={pathname}
        onSubmit={(e) => {
          e.preventDefault();
          const params = [
            ...(campos.de ? [`de=${campos.de}`] : []),
            ...(campos.ate ? [`ate=${campos.ate}`] : []),
          ];
          // mesmo período de novo: não há o que buscar
          if ((campos.de || undefined) === de && (campos.ate || undefined) === ate) return;
          setTocado(params.length ? "Personalizado" : (allLabel ?? "30 dias"));
          startTransition(() => router.push(comOutros(params)));
        }}
        className="flex flex-wrap items-end gap-2"
      >
        {Object.entries(extra ?? {})
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <label className="text-[11px] font-semibold text-gray-500">
          De
          <input
            type="date"
            name="de"
            value={campos.de}
            onChange={(e) => setCampos((c) => ({ ...c, de: e.target.value }))}
            className="block rounded-xl border border-gray-200 px-3 py-1.5 text-sm bg-white font-normal text-gray-700"
          />
        </label>
        <label className="text-[11px] font-semibold text-gray-500">
          Até
          <input
            type="date"
            name="ate"
            value={campos.ate}
            onChange={(e) => setCampos((c) => ({ ...c, ate: e.target.value }))}
            className="block rounded-xl border border-gray-200 px-3 py-1.5 text-sm bg-white font-normal text-gray-700"
          />
        </label>
        <button
          type="submit"
          className="rounded-xl bg-gray-900 hover:bg-gray-700 text-white text-xs font-semibold px-3.5 py-2 transition"
        >
          Filtrar
        </button>
        {(de || ate) && (
          <Link
            href={comOutros([])}
            onClick={() => setTocado(allLabel ?? "30 dias")}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 px-1 py-2"
          >
            Limpar
          </Link>
        )}
      </form>
    </div>
  );
}
