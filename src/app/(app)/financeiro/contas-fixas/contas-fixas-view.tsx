"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarSync, Pencil, Play, Plus, Square } from "lucide-react";
import { Button, Card, Field, Input, PageHeader, inputCls } from "@/components/ui";
import { brl } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import { FORMA_LABEL, FORMAS_PAGAMENTO, type FormaPagamento } from "@/lib/financeiro/lancamentos";

/**
 * CONTAS FIXAS (RN-031). A promessa da tela: configurou uma vez, o sistema
 * lança todo mês. Editar mexe SÓ nos meses futuros ainda não pagos — o
 * aluguel de agosto continua tendo sido o de agosto.
 */

type Recorrencia = {
  id: string;
  tipo: string;
  descricao: string;
  valor: number;
  diaVencimento: number;
  forma: string;
  categoriaId: string | null;
  categoria: string | null;
  fornecedorId: string | null;
  customerId: string | null;
  pessoa: string | null;
  contaId: string | null;
  conta: string | null;
  centroCustoId: string | null;
  colecaoId: string | null;
  observacoes: string | null;
  inicio: string;
  fim: string | null;
  ativa: boolean;
  geradoAte: string | null;
  gerados: number;
};

type Categoria = { id: string; nome: string; codigo: string; tipo: string };

export function ContasFixasView({
  mesAtual,
  contas,
  categorias,
  fornecedores,
  recorrencias,
}: {
  mesAtual: string;
  contas: { id: string; nome: string }[];
  categorias: Categoria[];
  fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
  recorrencias: Recorrencia[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState<Recorrencia | "nova" | null>(null);
  const [erro, setErro] = useState("");

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Contas fixas"
        subtitle="Aluguel, salário, internet, assinatura: configure uma vez e o sistema lança todo mês sozinho."
        action={
          <div className="flex gap-2">
            <Link
              href="/financeiro/contas-a-pagar"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Contas a Pagar
            </Link>
            {aberto === null && (
              <Button onClick={() => setAberto("nova")}>
                <Plus className="size-4" /> Nova conta fixa
              </Button>
            )}
          </div>
        }
      />

      {erro && <p className="mb-3 text-sm text-rose-600">{erro}</p>}

      {aberto !== null && (
        <FormRecorrencia
          mesAtual={mesAtual}
          contas={contas}
          categorias={categorias}
          fornecedores={fornecedores}
          editando={aberto === "nova" ? null : aberto}
          onFechar={() => setAberto(null)}
          onSalvo={() => {
            setAberto(null);
            router.refresh();
          }}
        />
      )}

      <Card className="divide-y divide-slate-100">
        {recorrencias.length === 0 && (
          <p className="p-5 text-sm text-slate-500">
            Nenhuma conta fixa. Cadastre o aluguel e ele passa a aparecer nas
            contas a pagar de todo mês, sem ninguém digitar.
          </p>
        )}
        {recorrencias.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 p-4">
            <CalendarSync
              className={`size-4 shrink-0 ${r.ativa ? "text-emerald-600" : "text-slate-300"}`}
            />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${r.ativa ? "text-slate-800" : "text-slate-400"}`}>
                {r.descricao}
                <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  {r.tipo === "RECEITA" ? "a receber" : "a pagar"}
                </span>
                {!r.ativa && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                    encerrada
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                Todo dia {r.diaVencimento} · {r.pessoa ?? "sem fornecedor"} ·{" "}
                {r.categoria ?? "sem categoria"} · {r.gerados} lançamento(s) gerado(s)
                {r.fim ? ` · até ${r.fim}` : " · sem data para acabar"}
              </p>
            </div>
            <span className="tabular-nums font-semibold text-slate-800">{brl(r.valor)}</span>
            <button
              type="button"
              title="Editar (vale para os próximos meses)"
              onClick={() => setAberto(r)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              title={r.ativa ? "Encerrar" : "Reativar"}
              onClick={async () => {
                try {
                  const res = await fetch(`/api/financeiro/recorrencias/${r.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ativa: !r.ativa }),
                  });
                  if (!res.ok) {
                    const d = await res.json().catch(() => null);
                    setErro(d?.error ?? "Não deu certo — tente de novo");
                    return;
                  }
                  setErro("");
                  router.refresh();
                } catch {
                  setErro("Sem conexão — confira a internet e tente de novo");
                }
              }}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              {r.ativa ? <Square className="size-4" /> : <Play className="size-4" />}
            </button>
          </div>
        ))}
      </Card>

      <p className="mt-4 text-xs text-slate-500">
        O sistema já deixa os próximos 3 meses lançados. Encerrar ou editar
        mexe só nos meses que ainda não venceram e não foram pagos — o
        histórico do que já aconteceu fica intocado.
      </p>
    </div>
  );
}

function FormRecorrencia({
  mesAtual,
  contas,
  categorias,
  fornecedores,
  editando,
  onFechar,
  onSalvo,
}: {
  mesAtual: string;
  contas: { id: string; nome: string }[];
  categorias: Categoria[];
  fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
  editando: Recorrencia | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [tipo, setTipo] = useState(editando?.tipo ?? "DESPESA");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [valor, setValor] = useState(
    editando ? editando.valor.toFixed(2).replace(".", ",") : ""
  );
  const [dia, setDia] = useState(String(editando?.diaVencimento ?? 5));
  const [fornecedorId, setFornecedorId] = useState(editando?.fornecedorId ?? "");
  const [categoriaId, setCategoriaId] = useState(editando?.categoriaId ?? "");
  const [contaId, setContaId] = useState(editando?.contaId ?? contas[0]?.id ?? "");
  const [forma, setForma] = useState<FormaPagamento>(
    (FORMAS_PAGAMENTO as readonly string[]).includes(editando?.forma ?? "")
      ? (editando!.forma as FormaPagamento)
      : "PIX"
  );
  const [inicio, setInicio] = useState(editando?.inicio ?? mesAtual);
  const [fim, setFim] = useState(editando?.fim ?? "");
  const [observacoes, setObservacoes] = useState(editando?.observacoes ?? "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const doTipo = categorias.filter((c) => c.tipo === tipo);

  async function salvar() {
    const v = numeroBR(valor);
    if (!descricao.trim() || !v || v <= 0) {
      setErro("Preencha a descrição e o valor (ex.: 1.500,00)");
      return;
    }
    setSalvando(true);
    setErro("");
    const corpo = {
      tipo,
      descricao: descricao.trim(),
      valor: v,
      diaVencimento: Math.min(31, Math.max(1, Number(dia) || 1)),
      fornecedorId: tipo === "DESPESA" ? fornecedorId || null : null,
      customerId: null,
      categoriaId: categoriaId || null,
      centroCustoId: editando?.centroCustoId ?? null,
      colecaoId: editando?.colecaoId ?? null,
      contaId: contaId || null,
      forma,
      observacoes: observacoes.trim() || null,
      inicio,
      fim: fim || null,
    };
    try {
      const res = await fetch(
        editando ? `/api/financeiro/recorrencias/${editando.id}` : "/api/financeiro/recorrencias",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        }
      );
      setSalvando(false);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return;
      }
      onSalvo();
    } catch {
      setSalvando(false);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  return (
    <Card className="mb-4 p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-800">
        {editando ? "Editar conta fixa" : "Nova conta fixa"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="É uma conta a…">
          <select
            className={inputCls}
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value);
              setCategoriaId("");
            }}
          >
            <option value="DESPESA">pagar (aluguel, salário, internet)</option>
            <option value="RECEITA">receber (mensalidade, aluguel recebido)</option>
          </select>
        </Field>
        <Field label="Descrição">
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Aluguel da loja"
          />
        </Field>
        <Field label="Valor (R$)">
          <Input inputMode="decimal" placeholder="1.500,00" value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <Field label="Vence todo dia" hint="Dia 31 cai no último dia dos meses curtos">
          <Input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} />
        </Field>
        {tipo === "DESPESA" && (
          <Field label="Fornecedor (opcional)">
            <select
              className={inputCls}
              value={fornecedorId}
              onChange={(e) => {
                setFornecedorId(e.target.value);
                const f = fornecedores.find((x) => x.id === e.target.value);
                if (f?.categoriaPadraoId && !categoriaId) setCategoriaId(f.categoriaPadraoId);
              }}
            >
              <option value="">— sem fornecedor —</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Categoria">
          <select className={inputCls} value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)}>
            <option value="">— sem categoria —</option>
            {doTipo.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nome}</option>
            ))}
          </select>
        </Field>
        <Field label="Conta prevista">
          <select className={inputCls} value={contaId} onChange={(e) => setContaId(e.target.value)}>
            <option value="">— escolher depois —</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </Field>
        <Field label="Forma">
          <select className={inputCls} value={forma} onChange={(e) => setForma(e.target.value as FormaPagamento)}>
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f} value={f}>{FORMA_LABEL[f]}</option>
            ))}
          </select>
        </Field>
        <Field label="Começa em" hint="Mês do primeiro lançamento">
          <Input type="month" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </Field>
        <Field label="Vai até (opcional)" hint="Em branco = sem data para acabar">
          <Input type="month" value={fim} onChange={(e) => setFim(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Observações (opcional)">
            <textarea className={`${inputCls} min-h-16`} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </Field>
        </div>
      </div>
      {editando && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          A mudança vale para os meses que ainda não venceram e não foram
          pagos. O que já aconteceu fica como está.
        </p>
      )}
      {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
      <div className="mt-4 flex gap-2">
        <Button onClick={salvar} disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar conta fixa"}
        </Button>
        <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
      </div>
    </Card>
  );
}
