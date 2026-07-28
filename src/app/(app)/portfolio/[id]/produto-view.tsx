"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Save, Trash2, X, Plus } from "lucide-react";
import { Card, Button, Badge, Input, Spinner, Alert } from "@/components/ui";
import {
  statusLabel,
  materialKindLabel,
  MATERIAL_KINDS,
  DRE_SIGNS,
  dreSignLabel,
  precoVigente,
  precoLabel,
  resumoFinanceiro,
  totalPositions,
} from "@/lib/portfolio";
import { Bloco, TextoLongo, TabelaEditavel, type Linha } from "./blocos";

/* ============================================================ TIPOS */

export type ProdutoDoc = {
  id: string;
  name: string;
  shortDesc: string;
  category: string;
  status: string;
  duration: string;
  baseValue: number | null;
  ownerName: string;
  fullDesc: string;
  icpText: string;
  icpForWhom: string;
  icpHowValue: string;
  scope: string;
  deliveryFormat: string;
  teamInvolved: string;
  howToSell: string;
  howToDeliver: string;
  notes: string;
  variants: { name: string; baseValue: number | null; description: string }[];
  positions: { role: string; hours: number; cost: number; note: string }[];
  dreLines: {
    label: string;
    sign: string;
    percent: number | null;
    value: number | null;
    highlight: boolean;
  }[];
  steps: {
    stage: string;
    task: string;
    detail: string;
    executor: string;
    estimate: string;
    popUrl: string;
  }[];
  materials: { kind: string; title: string; tag: string; url: string }[];
  salesFrames: {
    title: string;
    subtitle: string;
    colA: string;
    colB: string;
    colC: string;
    rows: { label: string; valueA: string; valueB: string; valueC: string }[];
  }[];
};

const SUMARIO = [
  { id: "visao-geral", label: "Visão geral" },
  { id: "variacoes", label: "Variações" },
  { id: "tecnicos", label: "Aspectos técnicos" },
  { id: "vender", label: "Informações para vender" },
  { id: "posicoes", label: "Posições alocadas" },
  { id: "dre", label: "Resultado (DRE)" },
  { id: "entrega", label: "Como eu entrego" },
  { id: "materiais", label: "Materiais" },
  { id: "notas", label: "Observações" },
];

const STATUS_COLOR: Record<string, string> = {
  DISPONIVEL: "#10b981",
  RASCUNHO: "#f59e0b",
  DESCONTINUADO: "#94a3b8",
};

/* ============================================================ TELA */

export function ProdutoView({ doc: inicial }: { doc: ProdutoDoc }) {
  const router = useRouter();
  const [doc, setDoc] = useState<ProdutoDoc>(inicial);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const set = <K extends keyof ProdutoDoc>(k: K, v: ProdutoDoc[K]) =>
    setDoc((d) => ({ ...d, [k]: v }));

  // O preço que vale é o do produto; variações aparecem no bloco delas.
  const preco = useMemo(
    () => precoVigente(doc.baseValue, doc.variants, null),
    [doc.baseValue, doc.variants]
  );
  const financeiro = useMemo(
    () => resumoFinanceiro(preco, doc.positions),
    [preco, doc.positions]
  );

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro("");
    setOk("");
    try {
      const res = await fetch(`/api/portfolio/${doc.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(paraApi(doc)),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Não foi possível salvar");
      setEditando(false);
      setOk("Alterações salvas.");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar() {
    if (!confirm(`Apagar "${doc.name}"? Isso remove todo o conteúdo dele.`)) {
      return;
    }
    const res = await fetch(`/api/portfolio/${doc.id}`, { method: "DELETE" });
    if (res.ok) router.push("/portfolio");
    else setErro("Não foi possível apagar.");
  }

  function cancelar() {
    setDoc(inicial);
    setEditando(false);
    setErro("");
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      {/* ---- topo ---- */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/portfolio"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 transition hover:text-slate-900"
        >
          <ArrowLeft className="size-4" /> Voltar ao portfólio
        </Link>
        <div className="flex items-center gap-2">
          {editando ? (
            <>
              <Button variant="ghost" onClick={cancelar} disabled={salvando}>
                <X className="size-4" /> Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando}>
                {salvando ? <Spinner /> : <Save className="size-4" />} Salvar
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger" onClick={apagar}>
                <Trash2 className="size-4" /> Apagar
              </Button>
              <Button onClick={() => setEditando(true)}>
                <Pencil className="size-4" /> Editar
              </Button>
            </>
          )}
        </div>
      </div>

      {erro && (
        <div className="mb-4">
          <Alert tone="danger">{erro}</Alert>
        </div>
      )}
      {ok && !editando && (
        <div className="mb-4">
          <Alert tone="success">{ok}</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* ---- sumário ---- */}
        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Sumário da página
            </p>
            <nav className="space-y-0.5">
              {SUMARIO.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="block rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <Cabecalho
            doc={doc}
            set={set}
            editando={editando}
            preco={preco}
            financeiro={financeiro}
          />

          <Bloco
            id="visao-geral"
            titulo="Visão geral do produto"
            descricao="O que é, para quem serve e como ele entrega valor."
          >
            <div className="space-y-5">
              <TextoLongo
                label="Descrição completa"
                value={doc.fullDesc}
                editando={editando}
                onChange={(v) => set("fullDesc", v)}
                linhas={7}
                placeholder="Explique o produto por inteiro…"
              />
              <TextoLongo
                label="Perfil de cliente ideal"
                value={doc.icpText}
                editando={editando}
                onChange={(v) => set("icpText", v)}
                linhas={6}
              />
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50/70 p-4">
                  <TextoLongo
                    label="Para quem serve"
                    value={doc.icpForWhom}
                    editando={editando}
                    onChange={(v) => set("icpForWhom", v)}
                  />
                </div>
                <div className="rounded-xl bg-slate-50/70 p-4">
                  <TextoLongo
                    label="Como entregar valor"
                    value={doc.icpHowValue}
                    editando={editando}
                    onChange={(v) => set("icpHowValue", v)}
                  />
                </div>
              </div>
            </div>
          </Bloco>

          <Bloco
            id="variacoes"
            titulo="Variações"
            descricao="Versões do mesmo produto. Quando a variação tem preço próprio, é ele que vale na venda."
          >
            <TabelaEditavel
              editando={editando}
              linhas={doc.variants as unknown as Linha[]}
              onChange={(l) =>
                set("variants", l as unknown as ProdutoDoc["variants"])
              }
              novaLinha={() => ({ name: "", baseValue: null, description: "" })}
              textoAdicionar="Adicionar variação"
              vazio="Produto sem variações — vale o valor base."
              cols={[
                { key: "name", label: "Variação", placeholder: "Basic, E-commerce…" },
                {
                  key: "baseValue",
                  label: "Valor",
                  tipo: "numero",
                  moeda: true,
                  alinha: "right",
                  largura: "140px",
                },
                { key: "description", label: "Observação", tipo: "area" },
              ]}
            />
          </Bloco>

          <Bloco
            id="tecnicos"
            titulo="Aspectos técnicos"
            descricao="Escopo, formato de entrega e time envolvido."
          >
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-100 p-4">
                <TextoLongo
                  label="Escopo"
                  value={doc.scope}
                  editando={editando}
                  onChange={(v) => set("scope", v)}
                  linhas={8}
                />
              </div>
              <div className="rounded-xl border border-slate-100 p-4">
                <TextoLongo
                  label="Formato de entrega"
                  value={doc.deliveryFormat}
                  editando={editando}
                  onChange={(v) => set("deliveryFormat", v)}
                  linhas={8}
                />
              </div>
              <div className="rounded-xl border border-slate-100 p-4">
                <TextoLongo
                  label="Time envolvido"
                  value={doc.teamInvolved}
                  editando={editando}
                  onChange={(v) => set("teamInvolved", v)}
                  linhas={8}
                />
              </div>
            </div>
          </Bloco>

          <Bloco
            id="vender"
            titulo="Informações para vender"
            descricao="O argumento de venda e os quadros que você usa na conversa."
          >
            <div className="space-y-6">
              <TextoLongo
                label="Como eu vendo?"
                value={doc.howToSell}
                editando={editando}
                onChange={(v) => set("howToSell", v)}
                linhas={8}
              />
              <QuadrosDeVenda
                frames={doc.salesFrames}
                editando={editando}
                onChange={(f) => set("salesFrames", f)}
              />
              <Materiais
                titulo={materialKindLabel.VENDAS}
                kind="VENDAS"
                materials={doc.materials}
                editando={editando}
                onChange={(m) => set("materials", m)}
              />
            </div>
          </Bloco>

          <Bloco
            id="posicoes"
            titulo="Posições alocadas"
            descricao="Quem executa, quantas horas e quanto custa. A soma é o custo de entrega."
          >
            <TabelaEditavel
              editando={editando}
              linhas={doc.positions as unknown as Linha[]}
              onChange={(l) =>
                set("positions", l as unknown as ProdutoDoc["positions"])
              }
              novaLinha={() => ({ role: "", hours: 0, cost: 0, note: "" })}
              textoAdicionar="Adicionar posição"
              vazio="Nenhuma posição alocada."
              cols={[
                { key: "role", label: "Posição" },
                {
                  key: "hours",
                  label: "Horas",
                  tipo: "numero",
                  alinha: "right",
                  largura: "110px",
                },
                {
                  key: "cost",
                  label: "Custo",
                  tipo: "numero",
                  moeda: true,
                  alinha: "right",
                  largura: "140px",
                },
                { key: "note", label: "Observação" },
              ]}
              rodape={
                doc.positions.length > 0 ? (
                  <tfoot className="border-t-2 border-slate-200">
                    <tr className="font-semibold text-slate-900">
                      <td className="px-3 py-3">Total</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {totalPositions(doc.positions).hours.toLocaleString(
                          "pt-BR",
                          { maximumFractionDigits: 2 }
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {precoLabel(totalPositions(doc.positions).cost)}
                      </td>
                      <td className="px-3 py-3" />
                      {editando && <td />}
                    </tr>
                  </tfoot>
                ) : undefined
              }
            />
          </Bloco>

          <Bloco
            id="dre"
            titulo="Resultado (DRE)"
            descricao="A conta do produto, linha a linha. Cada linha é livre — monte do seu jeito."
          >
            <TabelaEditavel
              editando={editando}
              linhas={doc.dreLines as unknown as Linha[]}
              onChange={(l) =>
                set("dreLines", l as unknown as ProdutoDoc["dreLines"])
              }
              novaLinha={() => ({
                label: "",
                sign: "NEUTRO",
                percent: null,
                value: null,
                highlight: false,
              })}
              textoAdicionar="Adicionar linha"
              vazio="Nenhuma linha na DRE."
              cols={[
                { key: "label", label: "Linha" },
                {
                  key: "sign",
                  label: "Tipo",
                  tipo: "select",
                  largura: "150px",
                  opcoes: DRE_SIGNS.map((s) => ({
                    value: s,
                    label: dreSignLabel[s],
                  })),
                },
                {
                  key: "percent",
                  label: "%",
                  tipo: "numero",
                  alinha: "right",
                  largura: "100px",
                },
                {
                  key: "value",
                  label: "Valor",
                  tipo: "numero",
                  moeda: true,
                  alinha: "right",
                  largura: "140px",
                },
              ]}
            />
          </Bloco>

          <Bloco
            id="entrega"
            titulo="Como eu entrego"
            descricao="O passo a passo da entrega, com quem executa e o procedimento de cada tarefa."
          >
            <div className="space-y-6">
              <TextoLongo
                value={doc.howToDeliver}
                editando={editando}
                onChange={(v) => set("howToDeliver", v)}
                linhas={7}
              />
              <div>
                <p className="mb-2 text-[13px] font-medium text-slate-700">
                  Etapas de entrega
                </p>
                <TabelaEditavel
                  editando={editando}
                  linhas={doc.steps as unknown as Linha[]}
                  onChange={(l) =>
                    set("steps", l as unknown as ProdutoDoc["steps"])
                  }
                  novaLinha={() => ({
                    stage: "",
                    task: "",
                    detail: "",
                    executor: "",
                    estimate: "",
                    popUrl: "",
                  })}
                  textoAdicionar="Adicionar etapa"
                  vazio="Nenhuma etapa cadastrada."
                  cols={[
                    { key: "stage", label: "Etapa", largura: "150px" },
                    { key: "task", label: "Tarefa" },
                    { key: "detail", label: "O quê", tipo: "area" },
                    { key: "executor", label: "Executor", largura: "160px" },
                    {
                      key: "estimate",
                      label: "Estimativa",
                      largura: "110px",
                      alinha: "right",
                    },
                    { key: "popUrl", label: "Procedimento", tipo: "url", largura: "130px" },
                  ]}
                />
              </div>
            </div>
          </Bloco>

          <Bloco
            id="materiais"
            titulo="Materiais"
            descricao="Sempre links — os arquivos continuam onde já estão hoje."
          >
            <div className="space-y-6">
              <Materiais
                titulo={materialKindLabel.OPERACIONAL}
                kind="OPERACIONAL"
                materials={doc.materials}
                editando={editando}
                onChange={(m) => set("materials", m)}
              />
              <Materiais
                titulo={materialKindLabel.TREINAMENTO}
                kind="TREINAMENTO"
                materials={doc.materials}
                editando={editando}
                onChange={(m) => set("materials", m)}
              />
            </div>
          </Bloco>

          <Bloco id="notas" titulo="Observações">
            <TextoLongo
              value={doc.notes}
              editando={editando}
              onChange={(v) => set("notes", v)}
              linhas={5}
              placeholder="Qualquer coisa que não coube nos blocos acima."
            />
          </Bloco>
        </div>
      </div>
    </div>
  );
}

/* ============================================================ CABEÇALHO */

function Cabecalho({
  doc,
  set,
  editando,
  preco,
  financeiro,
}: {
  doc: ProdutoDoc;
  set: <K extends keyof ProdutoDoc>(k: K, v: ProdutoDoc[K]) => void;
  editando: boolean;
  preco: number | null;
  financeiro: ReturnType<typeof resumoFinanceiro>;
}) {
  return (
    <Card className="p-5 sm:p-6">
      {editando ? (
        <div className="space-y-4">
          <Input
            value={doc.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Nome do produto"
            className="text-lg font-semibold"
          />
          <Input
            value={doc.shortDesc}
            onChange={(e) => set("shortDesc", e.target.value)}
            placeholder="Descrição curta (aparece no card da listagem)"
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CampoTexto
              label="Categoria"
              value={doc.category}
              onChange={(v) => set("category", v)}
              hint="Você cria as suas — basta digitar"
            />
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
                Status
              </span>
              <select
                value={doc.status}
                onChange={(e) => set("status", e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
              >
                {Object.entries(statusLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <CampoTexto
              label="Duração"
              value={doc.duration}
              onChange={(v) => set("duration", v)}
              hint="Recorrente, pontual, 3 meses…"
            />
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
                Valor base
              </span>
              <input
                type="number"
                step="any"
                value={doc.baseValue === null ? "" : String(doc.baseValue)}
                onChange={(e) =>
                  set(
                    "baseValue",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                placeholder="Deixe vazio para 'A definir'"
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <CampoTexto
              label="Responsável"
              value={doc.ownerName}
              onChange={(v) => set("ownerName", v)}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                {doc.name}
              </h1>
              {doc.shortDesc && (
                <p className="mt-1 text-sm text-slate-500">{doc.shortDesc}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {doc.category && <Badge color="#c4622d">{doc.category}</Badge>}
              <Badge color={STATUS_COLOR[doc.status] ?? "#94a3b8"}>
                {statusLabel[doc.status] ?? doc.status}
              </Badge>
            </div>
          </div>

          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Duração" valor={doc.duration || "—"} />
            <Info label="Valor base" valor={precoLabel(preco)} destaque />
            <Info
              label="Custo de entrega"
              valor={
                financeiro.custo > 0 ? precoLabel(financeiro.custo) : "—"
              }
            />
            <Info
              label="Margem"
              valor={
                financeiro.margemPct === null
                  ? "—"
                  : `${financeiro.margemPct.toFixed(1)}%`
              }
              tom={
                financeiro.margemPct === null
                  ? undefined
                  : financeiro.margemPct < 0
                    ? "ruim"
                    : "bom"
              }
            />
          </div>
          {doc.ownerName && (
            <p className="mt-4 text-xs text-slate-400">
              Responsável: <strong className="text-slate-600">{doc.ownerName}</strong>
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function CampoTexto({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
        {label}
      </span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function Info({
  label,
  valor,
  destaque,
  tom,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
  tom?: "bom" | "ruim";
}) {
  const cor =
    tom === "bom"
      ? "text-emerald-600"
      : tom === "ruim"
        ? "text-rose-600"
        : "text-slate-900";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={`mt-0.5 ${destaque ? "text-lg" : "text-sm"} font-semibold ${cor}`}
      >
        {valor}
      </p>
    </div>
  );
}

/* ============================================================ MATERIAIS */

function Materiais({
  titulo,
  kind,
  materials,
  editando,
  onChange,
}: {
  titulo: string;
  kind: string;
  materials: ProdutoDoc["materials"];
  editando: boolean;
  onChange: (m: ProdutoDoc["materials"]) => void;
}) {
  const meus = materials.filter((m) => m.kind === kind);
  const outros = materials.filter((m) => m.kind !== kind);

  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-slate-700">{titulo}</p>
      <TabelaEditavel
        editando={editando}
        linhas={meus as unknown as Linha[]}
        onChange={(l) =>
          // preserva os materiais dos outros tipos ao regravar este bloco
          onChange([
            ...outros,
            ...(l as unknown as ProdutoDoc["materials"]).map((m) => ({
              ...m,
              kind,
            })),
          ])
        }
        novaLinha={() => ({ kind, title: "", tag: "", url: "" })}
        textoAdicionar="Adicionar material"
        vazio="Nenhum material cadastrado."
        cols={[
          { key: "title", label: "Material" },
          { key: "tag", label: "Etiqueta", largura: "160px" },
          { key: "url", label: "Link", tipo: "url", largura: "120px" },
        ]}
      />
    </div>
  );
}

/* ============================================================ QUADROS */

function QuadrosDeVenda({
  frames,
  editando,
  onChange,
}: {
  frames: ProdutoDoc["salesFrames"];
  editando: boolean;
  onChange: (f: ProdutoDoc["salesFrames"]) => void;
}) {
  function setFrame(i: number, patch: Partial<ProdutoDoc["salesFrames"][0]>) {
    onChange(frames.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  if (!editando && frames.length === 0) return null;

  return (
    <div className="space-y-4">
      <p className="text-[13px] font-medium text-slate-700">
        Quadros de argumentação
      </p>

      {frames.map((f, i) => {
        // na leitura, coluna sem cabeçalho e sem conteúdo não ocupa espaço
        const usaB = editando || f.colB || f.rows.some((r) => r.valueB);
        const usaC = editando || f.colC || f.rows.some((r) => r.valueC);
        return (
          <div key={i} className="rounded-xl border border-slate-200 p-4">
            {editando ? (
              <div className="mb-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={f.title}
                    onChange={(e) => setFrame(i, { title: e.target.value })}
                    placeholder="Título do quadro"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(frames.filter((_, x) => x !== i))}
                    aria-label="Remover quadro"
                    className="grid size-10 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <Input
                  value={f.subtitle}
                  onChange={(e) => setFrame(i, { subtitle: e.target.value })}
                  placeholder="Subtítulo (opcional)"
                />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    value={f.colA}
                    onChange={(e) => setFrame(i, { colA: e.target.value })}
                    placeholder="Cabeçalho da coluna 1"
                  />
                  <Input
                    value={f.colB}
                    onChange={(e) => setFrame(i, { colB: e.target.value })}
                    placeholder="Cabeçalho da coluna 2"
                  />
                  <Input
                    value={f.colC}
                    onChange={(e) => setFrame(i, { colC: e.target.value })}
                    placeholder="Cabeçalho da coluna 3"
                  />
                </div>
              </div>
            ) : (
              <div className="mb-3">
                <p className="text-[15px] font-semibold text-slate-900">
                  {f.title}
                </p>
                {f.subtitle && (
                  <p className="text-sm text-slate-500">{f.subtitle}</p>
                )}
              </div>
            )}

            <TabelaEditavel
              editando={editando}
              linhas={f.rows as unknown as Linha[]}
              onChange={(l) =>
                setFrame(i, {
                  rows: l as unknown as ProdutoDoc["salesFrames"][0]["rows"],
                })
              }
              novaLinha={() => ({
                label: "",
                valueA: "",
                valueB: "",
                valueC: "",
              })}
              textoAdicionar="Adicionar linha"
              vazio="Quadro vazio."
              cols={[
                { key: "label", label: "Item", largura: "160px" },
                { key: "valueA", label: f.colA || "Conteúdo", tipo: "area" },
                ...(usaB
                  ? [
                      {
                        key: "valueB",
                        label: f.colB || "Coluna 2",
                        tipo: "area" as const,
                      },
                    ]
                  : []),
                ...(usaC
                  ? [
                      {
                        key: "valueC",
                        label: f.colC || "Coluna 3",
                        tipo: "area" as const,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        );
      })}

      {editando && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...frames,
              {
                title: "",
                subtitle: "",
                colA: "",
                colB: "",
                colC: "",
                rows: [],
              },
            ])
          }
          className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600"
        >
          <Plus className="size-4" /> Adicionar quadro
        </button>
      )}
    </div>
  );
}

/* ============================================================ ENVIO */

/** Converte a tela no formato que a API espera, limpando linhas vazias. */
function paraApi(d: ProdutoDoc) {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: d.name.trim(),
    shortDesc: t(d.shortDesc),
    category: t(d.category),
    status: d.status,
    duration: t(d.duration),
    baseValue: d.baseValue,
    ownerName: t(d.ownerName),
    fullDesc: t(d.fullDesc),
    icpText: t(d.icpText),
    icpForWhom: t(d.icpForWhom),
    icpHowValue: t(d.icpHowValue),
    scope: t(d.scope),
    deliveryFormat: t(d.deliveryFormat),
    teamInvolved: t(d.teamInvolved),
    howToSell: t(d.howToSell),
    howToDeliver: t(d.howToDeliver),
    notes: t(d.notes),
    variants: d.variants
      .filter((v) => v.name.trim())
      .map((v) => ({
        name: v.name,
        baseValue: v.baseValue,
        description: t(v.description),
      })),
    positions: d.positions
      .filter((p) => p.role.trim())
      .map((p) => ({
        role: p.role,
        hours: Number(p.hours) || 0,
        cost: Number(p.cost) || 0,
        note: t(p.note),
      })),
    dreLines: d.dreLines
      .filter((l) => l.label.trim())
      .map((l) => ({
        label: l.label,
        sign: l.sign,
        percent: l.percent,
        value: l.value,
        highlight: l.highlight,
      })),
    steps: d.steps
      .filter((s) => s.task.trim())
      .map((s) => ({
        stage: t(s.stage),
        task: s.task,
        detail: t(s.detail),
        executor: t(s.executor),
        estimate: t(s.estimate),
        popUrl: t(s.popUrl),
      })),
    materials: d.materials
      .filter((m) => m.title.trim())
      .map((m) => ({
        kind: MATERIAL_KINDS.includes(m.kind as never) ? m.kind : "VENDAS",
        title: m.title,
        tag: t(m.tag),
        url: t(m.url),
      })),
    salesFrames: d.salesFrames
      .filter((f) => f.title.trim())
      .map((f) => ({
        title: f.title,
        subtitle: t(f.subtitle),
        colA: t(f.colA),
        colB: t(f.colB),
        colC: t(f.colC),
        rows: f.rows
          .filter((r) => r.label.trim())
          .map((r) => ({
            label: r.label,
            valueA: t(r.valueA),
            valueB: t(r.valueB),
            valueC: t(r.valueC),
          })),
      })),
  };
}
