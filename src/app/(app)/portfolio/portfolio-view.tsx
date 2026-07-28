"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, LayoutGrid, List, ExternalLink, Package } from "lucide-react";
import { Card, Button, Badge, Input, EmptyState, Spinner } from "@/components/ui";
import {
  statusLabel,
  precoVigente,
  precoLabel,
  categoriasEmUso,
  matchBusca,
  resumoFinanceiro,
} from "@/lib/portfolio";

export type ProdutoRow = {
  id: string;
  name: string;
  shortDesc: string | null;
  category: string | null;
  status: string;
  duration: string | null;
  baseValue: number | null;
  ownerName: string | null;
  variants: { name: string; baseValue: number | null }[];
  custo: number;
};

/** Cores dos selos — paleta do AtacadoPro. */
const STATUS_COLOR: Record<string, string> = {
  DISPONIVEL: "#10b981",
  RASCUNHO: "#f59e0b",
  DESCONTINUADO: "#94a3b8",
};
const CATEGORIA_COLOR = "#c4622d";

export function PortfolioView({ initial }: { initial: ProdutoRow[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");
  const [status, setStatus] = useState("");
  const [modo, setModo] = useState<"cards" | "lista">("cards");
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const categorias = useMemo(() => categoriasEmUso(initial), [initial]);

  const filtrados = useMemo(
    () =>
      initial.filter(
        (p) =>
          matchBusca(p, busca) &&
          (!categoria || p.category === categoria) &&
          (!status || p.status === status)
      ),
    [initial, busca, categoria, status]
  );

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Não foi possível criar");
      router.push(`/portfolio/${data.id}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível criar");
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- barra de filtros ---- */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por produto ou descrição…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand-400"
            >
              <option value="">Todas as categorias</option>
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand-400"
            >
              <option value="">Todos os status</option>
              {Object.entries(statusLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <div className="flex overflow-hidden rounded-xl border border-slate-200">
              <button
                onClick={() => setModo("cards")}
                aria-label="Ver em cards"
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm ${
                  modo === "cards"
                    ? "bg-brand-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <LayoutGrid className="size-4" /> Cards
              </button>
              <button
                onClick={() => setModo("lista")}
                aria-label="Ver em lista"
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm ${
                  modo === "lista"
                    ? "bg-brand-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <List className="size-4" /> Lista
              </button>
            </div>
            <Button onClick={() => setCriando((v) => !v)}>
              <Plus className="size-4" /> Novo produto
            </Button>
          </div>
        </div>

        {criando && (
          <form onSubmit={criar} className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                autoFocus
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Nome do produto ou serviço"
              />
              <Button type="submit" disabled={!novoNome.trim() || salvando}>
                {salvando ? <Spinner /> : <Plus className="size-4" />}
                Criar e preencher
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Ele nasce como <strong>Rascunho</strong>. Você preenche o resto na
              página dele e marca como Disponível quando estiver pronto.
            </p>
            {erro && <p className="mt-2 text-sm text-rose-600">{erro}</p>}
          </form>
        )}
      </Card>

      {/* ---- resultado ---- */}
      {filtrados.length === 0 ? (
        <EmptyState
          icon={<Package />}
          title={
            initial.length === 0
              ? "Nenhum produto cadastrado ainda"
              : "Nada encontrado com esses filtros"
          }
          hint={
            initial.length === 0
              ? "Comece cadastrando o primeiro serviço que você vende junto com o AtacadoPro."
              : "Tente outro termo de busca ou limpe os filtros."
          }
        />
      ) : modo === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((p) => (
            <ProdutoCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <ProdutoLista rows={filtrados} />
      )}

      <p className="text-xs text-slate-400">
        {filtrados.length} de {initial.length}{" "}
        {initial.length === 1 ? "produto" : "produtos"}
      </p>
    </div>
  );
}

function ProdutoCard({ p }: { p: ProdutoRow }) {
  // sem variação escolhida, o card mostra o valor base do produto
  const preco = precoVigente(p.baseValue, p.variants, null);
  return (
    <Card interactive className="flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-slate-900">
          {p.name}
        </h3>
        <Link
          href={`/portfolio/${p.id}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Abrir <ExternalLink className="size-3" />
        </Link>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {p.category && <Badge color={CATEGORIA_COLOR}>{p.category}</Badge>}
        <Badge color={STATUS_COLOR[p.status] ?? "#94a3b8"}>
          {statusLabel[p.status] ?? p.status}
        </Badge>
        {p.variants.length > 0 && (
          <Badge color="#64748b">
            {p.variants.length}{" "}
            {p.variants.length === 1 ? "variação" : "variações"}
          </Badge>
        )}
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-500">
        {p.shortDesc?.trim() || (
          <span className="text-slate-300">Sem descrição curta</span>
        )}
      </p>

      <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">Valor base</span>
        <span
          className={`text-sm font-semibold ${
            preco === null ? "text-slate-400" : "text-slate-900"
          }`}
        >
          {precoLabel(preco)}
        </span>
      </div>
    </Card>
  );
}

function ProdutoLista({ rows }: { rows: ProdutoRow[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium">Categoria</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Valor base</th>
              <th className="px-4 py-3 text-right font-medium">Margem</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const preco = precoVigente(p.baseValue, p.variants, null);
              const { margemPct } = resumoFinanceiro(
                preco,
                p.custo ? [{ hours: 0, cost: p.custo }] : []
              );
              return (
                <tr key={p.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    {p.shortDesc && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">
                        {p.shortDesc}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {p.category || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={STATUS_COLOR[p.status] ?? "#94a3b8"}>
                      {statusLabel[p.status] ?? p.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">
                    {precoLabel(preco)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      margemPct === null
                        ? "text-slate-300"
                        : margemPct < 0
                          ? "text-rose-600"
                          : "text-emerald-600"
                    }`}
                  >
                    {margemPct === null ? "—" : `${margemPct.toFixed(1)}%`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/portfolio/${p.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                    >
                      Abrir <ExternalLink className="size-3" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
