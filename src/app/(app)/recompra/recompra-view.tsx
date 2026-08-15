"use client";

/**
 * ABA RECOMPRA — três blocos:
 *  1. Estágios: a loja por última compra (Ativa/Esfriando/Em risco/Sumida),
 *     com a estrela da tela: "PASSOU DO PONTO" — quem atrasou o próprio ritmo.
 *  2. VIPs: as 20 maiores compradoras, com o lançamento em primeira mão.
 *  3. Cutucadas de hoje: aniversariantes do mês e novidades do gosto de cada
 *     cliente. Tudo com mensagem pronta — a vendedora dispara, nada sai só.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Repeat,
  Crown,
  Gift,
  Sparkles,
  AlarmClock,
  MessageCircle,
} from "lucide-react";
import { brl, formatPhone } from "@/lib/format";
import { Card, PageHeader, EmptyState, Avatar } from "@/components/ui";
import {
  FAIXAS,
  type ClienteDeRecompra,
  type DadosDaAbaRecompra,
  type Faixa,
  mensagemAniversario,
  mensagemHoraDeRepor,
  mensagemNovidade,
  mensagemVipLancamento,
} from "@/lib/recompra";

type Filtro = "TODAS" | "PONTO" | Faixa;

function waHref(phone: string, texto: string): string {
  const dig = phone.replace(/\D/g, "");
  const fone = dig.length <= 11 ? `55${dig}` : dig;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

function BotaoWhats({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold px-2.5 py-1.5 transition"
    >
      <MessageCircle className="size-3.5" />
      {children}
    </a>
  );
}

export function RecompraView({ dados }: { dados: DadosDaAbaRecompra }) {
  const [filtro, setFiltro] = useState<Filtro>("TODAS");
  const { clientes, novidades, catalogLink, mesAtual } = dados;

  const contagens = useMemo(() => {
    const c: Record<string, number> = { TODAS: clientes.length, PONTO: 0 };
    for (const f of FAIXAS) c[f.id] = 0;
    for (const cl of clientes) {
      c[cl.faixa]++;
      if (cl.passouDoPonto) c.PONTO++;
    }
    return c;
  }, [clientes]);

  const lista = useMemo(() => {
    if (filtro === "TODAS") return clientes;
    if (filtro === "PONTO") return clientes.filter((c) => c.passouDoPonto);
    return clientes.filter((c) => c.faixa === filtro);
  }, [clientes, filtro]);

  const vips = useMemo(
    () =>
      clientes
        .filter((c) => c.vip !== null)
        .sort((a, b) => (a.vip ?? 99) - (b.vip ?? 99)),
    [clientes]
  );
  const aniversariantes = useMemo(
    () => clientes.filter((c) => c.aniversarioMes),
    [clientes]
  );
  const doGosto = (categoria: string) =>
    clientes
      .filter((c) => c.categoriaTop === categoria && c.phone)
      .slice(0, 6);

  const chip = (ativo: boolean, cor?: string) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
      ativo
        ? "text-white shadow-sm"
        : "bg-white border-gray-200 text-gray-500 hover:border-brand-300"
    }`;

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="Recompra"
        subtitle="Quem está na hora de comprar de novo — pelo ritmo de cada cliente — e as VIPs da loja. Toque e a mensagem sai pronta."
        action={
          <Link
            href="/recompra/painel"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:border-brand-300 transition"
          >
            📊 Painel de Recompra
          </Link>
        }
      />

      {clientes.length === 0 ? (
        <Card>
          <EmptyState
            title="Ainda não há clientes com compra paga"
            hint="Assim que as vendas entrarem, cada cliente aparece aqui com o estágio de recompra dela."
          />
        </Card>
      ) : (
        <>
          {/* ---- filtros de estágio ---- */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setFiltro("TODAS")} className={chip(filtro === "TODAS")} style={filtro === "TODAS" ? { background: "#1f2937", borderColor: "#1f2937" } : undefined}>
              Todas · {contagens.TODAS}
            </button>
            <button
              onClick={() => setFiltro("PONTO")}
              className={chip(filtro === "PONTO")}
              style={filtro === "PONTO" ? { background: "#7c3aed", borderColor: "#7c3aed" } : undefined}
              title="Atrasou a reposição em relação ao ritmo DELA — o alerta mais certeiro da tela"
            >
              ⏰ Passou do ponto · {contagens.PONTO}
            </button>
            {FAIXAS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={chip(filtro === f.id)}
                style={filtro === f.id ? { background: f.cor, borderColor: f.cor } : undefined}
              >
                {f.rotulo} · {contagens[f.id]}
              </button>
            ))}
          </div>

          {/* ---- lista por estágio ---- */}
          <Card className="p-0 overflow-hidden mb-6">
            <ul className="divide-y divide-gray-100">
              {lista.length === 0 && (
                <li className="p-6 text-center text-sm text-gray-400">
                  Ninguém neste estágio agora 🎉
                </li>
              )}
              {lista.slice(0, 60).map((c) => {
                const faixa = FAIXAS.find((f) => f.id === c.faixa)!;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={c.name} color={faixa.cor} size="sm" />
                    <div className="flex-1 min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold truncate">
                        <Link href={`/clientes/${c.id}`} className="hover:text-brand-600 truncate">
                          {c.name}
                        </Link>
                        {c.vip !== null && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 text-amber-700 px-1.5 py-0.5 text-[10px] font-bold shrink-0"
                            title={`VIP nº ${c.vip} da loja`}
                          >
                            <Crown className="size-3" /> VIP
                          </span>
                        )}
                        {c.aniversarioMes && (
                          <span title={`Aniversariante de ${mesAtual}`} className="shrink-0">
                            🎂
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {formatPhone(c.phone)} · última compra há {c.diasDesde}{" "}
                        dia{c.diasDesde === 1 ? "" : "s"} ·{" "}
                        {c.cicloDias
                          ? `repõe a cada ~${c.cicloDias} dias`
                          : `${c.compras}ª compra ainda não veio`}
                        {c.categoriaTop ? ` · ama ${c.categoriaTop}` : ""}
                      </p>
                    </div>
                    {c.passouDoPonto && (
                      <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-violet-100 text-violet-700 px-2 py-0.5 text-[10px] font-bold shrink-0">
                        <AlarmClock className="size-3" /> passou do ponto
                      </span>
                    )}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-emerald-700 tabular-nums">
                        {brl(c.total)}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {c.compras} compra{c.compras === 1 ? "" : "s"}
                      </p>
                    </div>
                    {c.phone && (
                      <BotaoWhats
                        href={waHref(c.phone, mensagemHoraDeRepor(c.name, c.cicloDias, catalogLink))}
                      >
                        Chamar
                      </BotaoWhats>
                    )}
                  </li>
                );
              })}
              {lista.length > 60 && (
                <li className="p-3 text-center text-[11px] text-gray-400">
                  Mostrando as 60 primeiras — afine pelo filtro de estágio.
                </li>
              )}
            </ul>
          </Card>

          <div className="grid lg:grid-cols-2 gap-4 md:gap-6">
            {/* ---- VIPs ---- */}
            <Card className="p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-1">
                <Crown className="size-4 text-amber-500" />
                VIPs — Top {vips.length} da loja
              </h2>
              <p className="text-[11px] text-gray-400 mb-3">
                As maiores compradoras. Lançou coleção? Elas veem primeiro — quem
                escolhe antes compra a grade cheia.
              </p>
              <ul className="space-y-1.5">
                {vips.slice(0, 10).map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5">
                    <span className="w-6 text-center text-xs font-bold text-amber-500">
                      {c.vip}º
                    </span>
                    <Link
                      href={`/clientes/${c.id}`}
                      className="flex-1 min-w-0 truncate text-sm font-medium hover:text-brand-600"
                    >
                      {c.name}
                    </Link>
                    <span className="text-xs font-semibold text-emerald-700 tabular-nums shrink-0">
                      {brl(c.total)}
                    </span>
                    {c.phone && (
                      <BotaoWhats href={waHref(c.phone, mensagemVipLancamento(c.name, catalogLink))}>
                        <Sparkles className="size-3" /> Lançamento
                      </BotaoWhats>
                    )}
                  </li>
                ))}
              </ul>
              {vips.length > 10 && (
                <p className="mt-2 text-[11px] text-gray-400">
                  …e mais {vips.length - 10} VIPs (use o selo 👑 na lista de cima).
                </p>
              )}
            </Card>

            {/* ---- cutucadas de hoje ---- */}
            <div className="space-y-4">
              <Card className="p-5">
                <h2 className="font-semibold flex items-center gap-2 mb-1">
                  <Gift className="size-4 text-rose-500" />
                  Aniversariantes de {mesAtual}
                </h2>
                <p className="text-[11px] text-gray-400 mb-3">
                  A mensagem que mais vende no ano — e a mais barata de mandar.
                </p>
                {aniversariantes.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Nenhuma aniversariante com compra este mês. (Cadastre a data
                    de nascimento na ficha para elas aparecerem aqui.)
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {aniversariantes.map((c) => (
                      <li key={c.id} className="flex items-center gap-2.5">
                        <span>🎂</span>
                        <Link
                          href={`/clientes/${c.id}`}
                          className="flex-1 min-w-0 truncate text-sm font-medium hover:text-brand-600"
                        >
                          {c.name}
                        </Link>
                        {c.phone && (
                          <BotaoWhats href={waHref(c.phone, mensagemAniversario(c.name, catalogLink))}>
                            Parabenizar
                          </BotaoWhats>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="font-semibold flex items-center gap-2 mb-1">
                  <Sparkles className="size-4 text-brand-600" />
                  Novidade do gosto dela
                </h2>
                <p className="text-[11px] text-gray-400 mb-3">
                  Produto novo no catálogo → quem mais compra daquela categoria.
                </p>
                {novidades.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Nenhum produto novo nos últimos 14 dias. Cadastrou novidade?
                    As clientes do gosto aparecem aqui sozinhas.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {novidades.slice(0, 4).map((n) => {
                      const alvo = doGosto(n.categoria);
                      return (
                        <div key={n.categoria}>
                          <p className="text-xs font-bold text-gray-600 mb-1">
                            {n.categoria}{" "}
                            <span className="font-normal text-gray-400">
                              · {n.produtos} novidade{n.produtos === 1 ? "" : "s"}
                            </span>
                          </p>
                          {alvo.length === 0 ? (
                            <p className="text-[11px] text-gray-400">
                              Ainda sem cliente com histórico nessa categoria.
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {alvo.map((c) => (
                                <li key={c.id} className="flex items-center gap-2">
                                  <span className="flex-1 min-w-0 truncate text-sm">{c.name}</span>
                                  <BotaoWhats
                                    href={waHref(
                                      c.phone,
                                      mensagemNovidade(c.name, n.categoria, catalogLink)
                                    )}
                                  >
                                    Avisar
                                  </BotaoWhats>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>

          <p className="mt-6 text-[11px] text-gray-400 flex items-center gap-1.5">
            <Repeat className="size-3.5" />
            “Passou do ponto” = atrasou a reposição em relação ao ritmo DELA
            (aprendido das compras anteriores). Nada é enviado sozinho — você
            decide quem chamar.
          </p>
        </>
      )}
    </div>
  );
}
