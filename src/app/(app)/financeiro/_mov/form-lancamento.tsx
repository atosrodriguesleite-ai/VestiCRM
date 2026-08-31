"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Portal } from "@/components/portal";
import { Button, Field, Input, inputCls } from "@/components/ui";
import { brl } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import {
  dividirEmParcelas,
  FORMA_LABEL,
  FORMAS_PAGAMENTO,
  vencimentosMensais,
  type FormaPagamento,
} from "@/lib/financeiro/lancamentos";

/**
 * NOVO / EDITAR LANÇAMENTO (RN-028).
 *
 * A lojista digita o valor TOTAL e o número de parcelas; o sistema monta os
 * vencimentos (mensais, respeitando fim de mês) e divide sem perder centavo —
 * e ela ainda pode ajustar cada linha na mão, porque a vida real tem
 * "metade agora, metade quando vender".
 */

export type Opcao = { id: string; nome: string; codigo?: string };

type ParcelaForm = {
  vencimento: string;
  valor: string;
  contaId: string;
  forma: FormaPagamento;
};

export type LancamentoParaEditar = {
  id: string;
  descricao: string;
  documento: string | null;
  competencia: string;
  customerId: string | null;
  customerNome: string | null;
  fornecedorId: string | null;
  categoriaId: string | null;
  centroCustoId: string | null;
  colecaoId: string | null;
  observacoes: string | null;
  parcelas: {
    vencimento: string;
    valor: number;
    contaId: string | null;
    forma: string;
  }[];
};

export function FormLancamento({
  tipo,
  hoje,
  contas,
  categorias,
  fornecedores,
  centros,
  colecoes,
  editando,
  onFechar,
  onSalvo,
}: {
  tipo: "RECEITA" | "DESPESA";
  hoje: string;
  contas: { id: string; nome: string; padrao: boolean }[];
  categorias: Opcao[];
  fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
  centros: Opcao[];
  colecoes: Opcao[];
  editando?: LancamentoParaEditar;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const receita = tipo === "RECEITA";
  const contaPadrao = contas.find((c) => c.padrao)?.id ?? contas[0]?.id ?? "";

  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [documento, setDocumento] = useState(editando?.documento ?? "");
  const [competencia, setCompetencia] = useState(editando?.competencia ?? hoje);
  const [categoriaId, setCategoriaId] = useState(editando?.categoriaId ?? "");
  const [centroCustoId, setCentroCustoId] = useState(editando?.centroCustoId ?? "");
  const [colecaoId, setColecaoId] = useState(editando?.colecaoId ?? "");
  const [observacoes, setObservacoes] = useState(editando?.observacoes ?? "");
  const [fornecedorId, setFornecedorId] = useState(editando?.fornecedorId ?? "");

  // cliente: busca por nome/telefone (a loja tem milhares — lista fechada não serve)
  const [customerId, setCustomerId] = useState(editando?.customerId ?? "");
  const [clienteBusca, setClienteBusca] = useState(editando?.customerNome ?? "");
  const [clienteOpcoes, setClienteOpcoes] = useState<
    { id: string; name: string; phone: string | null }[]
  >([]);

  const [valorTotal, setValorTotal] = useState(
    editando
      ? String(editando.parcelas.reduce((s, p) => s + p.valor, 0).toFixed(2)).replace(".", ",")
      : ""
  );
  const [qtdParcelas, setQtdParcelas] = useState(
    String(editando?.parcelas.length ?? 1)
  );
  const [primeiroVenc, setPrimeiroVenc] = useState(
    editando?.parcelas[0]?.vencimento ?? hoje
  );
  const [parcelas, setParcelas] = useState<ParcelaForm[]>(
    editando
      ? editando.parcelas.map((p) => ({
          vencimento: p.vencimento,
          valor: p.valor.toFixed(2).replace(".", ","),
          contaId: p.contaId ?? "",
          forma: (FORMAS_PAGAMENTO as readonly string[]).includes(p.forma)
            ? (p.forma as FormaPagamento)
            : "PIX",
        }))
      : [{ vencimento: hoje, valor: "", contaId: contaPadrao, forma: "PIX" }]
  );
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (receita) return;
    // fornecedor com categoria padrão etiqueta a conta sozinho
    const f = fornecedores.find((x) => x.id === fornecedorId);
    if (f?.categoriaPadraoId && !categoriaId) setCategoriaId(f.categoriaPadraoId);
  }, [fornecedorId, fornecedores, receita, categoriaId]);

  useEffect(() => {
    if (!receita) return;
    const termo = clienteBusca.trim();
    if (termo.length < 2 || (customerId && termo === editando?.customerNome)) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(termo)}`);
        if (res.ok) setClienteOpcoes(await res.json());
      } catch {
        /* busca de cliente é conveniência: sem rede, ela digita o resto */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clienteBusca, receita, customerId, editando?.customerNome]);

  /** Redistribui o total nas N parcelas (sem perder centavo) e refaz as datas. */
  function gerarParcelas() {
    const total = numeroBR(valorTotal);
    const n = Math.max(1, Math.min(60, Number(qtdParcelas) || 1));
    if (total === null || total <= 0) {
      setErro("Informe o valor total (ex.: 1.500,00)");
      return;
    }
    const base = new Date(`${primeiroVenc}T12:00:00.000Z`);
    if (Number.isNaN(base.getTime())) {
      setErro("Informe o primeiro vencimento");
      return;
    }
    const valores = dividirEmParcelas(total, n);
    const datas = vencimentosMensais(base, n);
    setParcelas(
      valores.map((v, i) => ({
        vencimento: datas[i].toISOString().slice(0, 10),
        valor: v.toFixed(2).replace(".", ","),
        contaId: parcelas[i]?.contaId ?? contaPadrao,
        forma: parcelas[i]?.forma ?? "PIX",
      }))
    );
    setErro("");
  }

  const somaParcelas = useMemo(
    () => parcelas.reduce((s, p) => s + (numeroBR(p.valor) ?? 0), 0),
    [parcelas]
  );

  function mudarParcela(i: number, mudanca: Partial<ParcelaForm>) {
    setParcelas((atual) =>
      atual.map((p, idx) => (idx === i ? { ...p, ...mudanca } : p))
    );
  }

  async function salvar() {
    if (!descricao.trim()) {
      setErro("Escreva uma descrição — é o que a loja vai reconhecer na lista");
      return;
    }
    const linhas = parcelas.map((p) => ({
      vencimento: p.vencimento,
      valor: numeroBR(p.valor) ?? 0,
      contaId: p.contaId || null,
      forma: p.forma,
    }));
    if (linhas.some((l) => !(l.valor > 0))) {
      setErro("Toda parcela precisa de um valor maior que zero");
      return;
    }
    if (linhas.some((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.vencimento))) {
      setErro("Toda parcela precisa de um vencimento");
      return;
    }
    setSalvando(true);
    setErro("");
    const corpo = {
      tipo,
      descricao: descricao.trim(),
      documento: documento.trim() || null,
      competencia,
      customerId: receita ? customerId || null : null,
      fornecedorId: receita ? null : fornecedorId || null,
      categoriaId: categoriaId || null,
      centroCustoId: centroCustoId || null,
      colecaoId: colecaoId || null,
      observacoes: observacoes.trim() || null,
      parcelas: linhas,
    };
    try {
      const res = await fetch(
        editando
          ? `/api/financeiro/lancamentos/${editando.id}`
          : "/api/financeiro/lancamentos",
        {
          method: editando ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        }
      );
      setSalvando(false);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.error ?? "Não deu certo — tente de novo");
        return;
      }
      onSalvo();
    } catch {
      setSalvando(false);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
        <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-3xl sm:rounded-2xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {editando ? "Editar lançamento" : receita ? "Nova conta a receber" : "Nova conta a pagar"}
            </h2>
            <button
              type="button"
              onClick={onFechar}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              aria-label="Fechar"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Descrição">
                <Input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder={receita ? "Venda para a loja da Ana" : "Tecido — pedido 220"}
                />
              </Field>
            </div>

            {receita ? (
              <Field
                label="Cliente (opcional)"
                hint={
                  clienteBusca.trim() && !customerId
                    ? "Escolha o nome na lista abaixo — senão o lançamento fica sem cliente"
                    : "A ficha é a mesma do CRM"
                }
              >
                <Input
                  value={clienteBusca}
                  onChange={(e) => {
                    setClienteBusca(e.target.value);
                    setCustomerId("");
                  }}
                  placeholder="Buscar por nome ou telefone…"
                />
                {/* sem <datalist>: escolher por ele preenchia o nome e deixava
                    o customerId vazio — a conta a receber nascia sem cliente
                    e sem aviso (achado da revisão 31/08/2026) */}
                {clienteOpcoes.length > 0 && !customerId && (
                  <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-slate-200">
                    {clienteOpcoes.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomerId(c.id);
                          setClienteBusca(c.name);
                          setClienteOpcoes([]);
                        }}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      >
                        {c.name}
                        {c.phone && (
                          <span className="ml-2 text-xs text-slate-400">{c.phone}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            ) : (
              <Field label="Fornecedor (opcional)">
                <select
                  className={inputCls}
                  value={fornecedorId}
                  onChange={(e) => setFornecedorId(e.target.value)}
                >
                  <option value="">— sem fornecedor —</option>
                  {fornecedores.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Categoria">
              <select
                className={inputCls}
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
              >
                <option value="">— sem categoria —</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nome}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Data de emissão">
              <Input
                type="date"
                value={competencia}
                onChange={(e) => setCompetencia(e.target.value)}
              />
            </Field>
            <Field label="Documento (opcional)" hint="Nº da nota, contrato, boleto">
              <Input value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </Field>

            {centros.length > 0 && (
              <Field label="Centro de custo (opcional)">
                <select
                  className={inputCls}
                  value={centroCustoId}
                  onChange={(e) => setCentroCustoId(e.target.value)}
                >
                  <option value="">—</option>
                  {centros.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {colecoes.length > 0 && (
              <Field label="Coleção (opcional)">
                <select
                  className={inputCls}
                  value={colecaoId}
                  onChange={(e) => setColecaoId(e.target.value)}
                >
                  <option value="">—</option>
                  {colecoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-800">
              Condição de pagamento
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-slate-500">
                Valor total (R$)
                <Input
                  className="mt-1 !py-2"
                  inputMode="decimal"
                  placeholder="1.500,00"
                  value={valorTotal}
                  onChange={(e) => setValorTotal(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-500">
                Parcelas
                <Input
                  className="mt-1 !py-2 w-24"
                  inputMode="numeric"
                  value={qtdParcelas}
                  onChange={(e) => setQtdParcelas(e.target.value)}
                />
              </label>
              <label className="text-xs text-slate-500">
                1º vencimento
                <Input
                  type="date"
                  className="mt-1 !py-2"
                  value={primeiroVenc}
                  onChange={(e) => setPrimeiroVenc(e.target.value)}
                />
              </label>
              <Button size="sm" variant="secondary" onClick={gerarParcelas}>
                Gerar parcelas
              </Button>
            </div>

            <div className="mt-4 space-y-2">
              {parcelas.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-8 shrink-0 text-xs text-slate-400">
                    {i + 1}/{parcelas.length}
                  </span>
                  <Input
                    type="date"
                    className="!py-2 w-40"
                    value={p.vencimento}
                    onChange={(e) => mudarParcela(i, { vencimento: e.target.value })}
                  />
                  <Input
                    className="!py-2 w-32"
                    inputMode="decimal"
                    value={p.valor}
                    onChange={(e) => mudarParcela(i, { valor: e.target.value })}
                  />
                  <select
                    className={`${inputCls} !py-2 w-44`}
                    value={p.contaId}
                    onChange={(e) => mudarParcela(i, { contaId: e.target.value })}
                  >
                    <option value="">— conta —</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                  <select
                    className={`${inputCls} !py-2 w-40`}
                    value={p.forma}
                    onChange={(e) =>
                      mudarParcela(i, { forma: e.target.value as FormaPagamento })
                    }
                  >
                    {FORMAS_PAGAMENTO.map((f) => (
                      <option key={f} value={f}>
                        {FORMA_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-slate-500">
              Soma das parcelas:{" "}
              <b className="text-slate-800">{brl(somaParcelas)}</b> — é este o
              valor do lançamento.
            </p>
          </div>

          <div className="mt-4">
            <Field label="Observações (opcional)">
              <textarea
                className={`${inputCls} min-h-20`}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </Field>
          </div>

          {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}

          <div className="mt-5 flex gap-2">
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar lançamento"}
            </Button>
            <Button variant="secondary" onClick={onFechar}>
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
