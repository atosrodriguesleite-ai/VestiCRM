"use client";

/**
 * PAINEL DO ESTOQUE (RN-052): totais do setor e as três listas que decidem
 * o dia — o que repor (chegou ao mínimo, com a quantidade sugerida), o que
 * encalhou (peça parada há 60 dias, com o dinheiro a custo) e o que mais
 * vende. Cada número diz a conta que o gerou; nada é palpite.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, PackageOpen, Snowflake, TrendingUp } from "lucide-react";
import { Alert, Spinner } from "@/components/ui";
import { brl } from "@/lib/format";
import type { Painel, LinhaAnalisada } from "@/lib/estoque/analise";
import { NOME_DO_DONO } from "@/lib/estoque/dono-do-estoque";

export function PainelView() {
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch("/api/estoque/painel", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !d) setErro(d?.error ?? "Não foi possível carregar o painel.");
        else setDados(d);
      })
      .catch(() => vivo && setErro("Não foi possível carregar o painel."));
    return () => {
      vivo = false;
    };
  }, []);

  if (erro)
    return (
      <Alert tone="danger" icon={<AlertTriangle />}>
        {erro}
      </Alert>
    );
  if (!dados)
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Spinner />
      </div>
    );

  const t = dados.totais;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Numero rotulo="Peças na loja" valor={t.pecas.toLocaleString("pt-BR")} hint={`${t.variacoes} variações`} />
        <Numero rotulo="Valor a custo" valor={brl(t.valorCusto)} hint={`na loja, inclusive ${t.reservadas} reservadas`} />
        <Numero rotulo="Valor a atacado" valor={brl(t.valorAtacado)} hint="se vender tudo que está na loja no atacado" />
        <Numero
          rotulo="No mínimo"
          valor={String(t.noMinimo)}
          hint={`${t.zeradas} zeradas`}
          tom={t.noMinimo > 0 ? "amber" : "emerald"}
        />
        <Numero
          rotulo="Encalhadas"
          valor={String(t.encalhadas)}
          hint={`${brl(t.valorEncalhadoCusto)} parados`}
          tom={t.encalhadas > 0 ? "rose" : "emerald"}
        />
        <Numero
          rotulo={`Vendidas em ${dados.diasDoGiro} dias`}
          valor={t.vendidos30.toLocaleString("pt-BR")}
          hint={`giro de ${t.giroPct.toFixed(0)}% do que estava à venda`}
          tom="emerald"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Lista
          titulo="O que repor"
          icon={<PackageOpen className="size-4 text-amber-600" />}
          vazio="Nada chegou ao mínimo. 👍"
          hint={`Toda peça que chegou ao mínimo (a mesma conta do card e do sino). A sugestão cobre ${dados.diasDoGiro} dias no ritmo atual, nunca menos que o dobro do mínimo; peça da Nuvemshop/Jueri se repõe lá.`}
          rodape={
            t.noMinimo > 0 ? (
              <Link href="/estoque?filtro=baixo" className="text-xs text-brand-700 hover:underline">
                ver todas no Inventário →
              </Link>
            ) : null
          }
          linhas={dados.repor}
          colunas={[
            { rotulo: "Disp. / mín.", valor: (l) => `${l.disponivel} / ${l.minimo}` },
            { rotulo: "Cobertura", valor: (l) => cobertura(l) },
            {
              rotulo: "Repor",
              valor: (l) =>
                l.dono ? `na ${NOME_DO_DONO[l.dono]}` : l.analise.repor > 0 ? String(l.analise.repor) : "—",
              destaque: true,
            },
          ]}
        />
        <Lista
          titulo="Encalhadas"
          icon={<Snowflake className="size-4 text-sky-600" />}
          vazio="Nenhuma peça parada. 🎉"
          hint={`Tem peça disponível e não vende há ${dados.diasParaEncalhar} dias — ou nunca vendeu e foi cadastrada há ${dados.diasParaEncalhar}+ dias. Valor a custo.`}
          linhas={dados.encalhadas}
          colunas={[
            { rotulo: "Na loja", valor: (l) => String(l.emEstoque) },
            {
              rotulo: "Sem venda",
              valor: (l) =>
                l.analise.diasSemVenda === null
                  ? l.analise.diasDeCadastro > 365
                    ? "há mais de 1 ano"
                    : `nunca (${l.analise.diasDeCadastro} dias de cadastro)`
                  : `${l.analise.diasSemVenda} dias`,
            },
            { rotulo: "Parado", valor: (l) => brl(l.analise.valorParadoCusto), destaque: true },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Lista
          titulo={`Mais vendidas (${dados.diasDoGiro} dias)`}
          icon={<TrendingUp className="size-4 text-emerald-600" />}
          vazio="Nenhuma venda paga no período."
          hint={`Só pedido pago conta, e só item ligado a uma peça do cadastro${t.vendidasSemPeca > 0 ? ` — ${t.vendidasSemPeca} peça(s) vendida(s) no período sem peça no cadastro ficaram fora` : ""}. A cobertura diz para quantos dias o disponível dá no ritmo atual.`}
          linhas={dados.maisVendidas}
          colunas={[
            { rotulo: "Vendidas", valor: (l) => String(l.analise.vendidos30), destaque: true },
            { rotulo: "Disponível", valor: (l) => String(l.disponivel) },
            { rotulo: "Cobertura", valor: (l) => cobertura(l) },
          ]}
        />
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Por categoria</p>
            <p className="text-[11px] text-slate-400">Peças na loja, valor a custo e vendidas no período.</p>
          </div>
          {dados.porCategoria.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400 text-center">Sem produtos ativos.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Categoria</th>
                    <th className="text-right px-3 py-2 font-medium">Peças</th>
                    <th className="text-right px-3 py-2 font-medium">A custo</th>
                    <th className="text-right px-3 py-2 font-medium">Vendidas</th>
                    <th className="text-right px-3 py-2 font-medium">No mín.</th>
                    <th className="text-right px-3 py-2 font-medium">Encalh.</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.porCategoria.map((c) => (
                    <tr key={c.categoria} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-800">{c.categoria}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.pecas}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(c.valorCusto)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{c.vendidos30}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.noMinimo ? "text-amber-700 font-semibold" : "text-slate-300"}`} title={c.noMinimo ? "variações que chegaram ao mínimo" : undefined}>
                        {c.noMinimo ? `⚠ ${c.noMinimo}` : c.noMinimo}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${c.encalhadas ? "text-sky-700" : "text-slate-300"}`}>{c.encalhadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cobertura(l: LinhaAnalisada) {
  return l.analise.coberturaDias === null ? "sem venda" : `${l.analise.coberturaDias} dias`;
}

function Numero({ rotulo, valor, hint, tom }: { rotulo: string; valor: string; hint?: string; tom?: "emerald" | "amber" | "rose" }) {
  const cor =
    tom === "emerald" ? "text-emerald-700" : tom === "amber" ? "text-amber-700" : tom === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p className={`text-lg font-semibold tabular-nums ${cor}`}>{valor}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function Lista({
  titulo,
  icon,
  hint,
  vazio,
  linhas,
  colunas,
  rodape,
}: {
  titulo: string;
  icon: React.ReactNode;
  hint: string;
  vazio: string;
  linhas: LinhaAnalisada[];
  colunas: { rotulo: string; valor: (l: LinhaAnalisada) => string; destaque?: boolean }[];
  rodape?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start gap-2">
        <span className="mt-0.5">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">{titulo}</p>
          <p className="text-[11px] text-slate-400">{hint}</p>
        </div>
      </div>
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-xs text-slate-400 text-center">{vazio}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Peça</th>
                {colunas.map((c) => (
                  <th key={c.rotulo} className="text-right px-3 py-2 font-medium">
                    {c.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.variantId} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <div className="text-slate-800 leading-tight">{l.produto}</div>
                    <div className="text-[11px] text-slate-400">
                      {[l.cor, l.tamanho].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  {colunas.map((c) => (
                    <td
                      key={c.rotulo}
                      className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${c.destaque ? "font-semibold text-slate-900" : "text-slate-600"}`}
                    >
                      {c.valor(l)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rodape && <div className="px-4 py-2 border-t border-slate-100">{rodape}</div>}
    </div>
  );
}
