"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CircleDollarSign,
  Download,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui";
import { brl } from "@/lib/format";
import { STATUS_LABEL, type StatusParcela } from "@/lib/financeiro/lancamentos";
import { BaixaModal } from "../../_mov/baixa-modal";
import {
  FormLancamento,
  type LancamentoParaEditar,
  type Opcao,
} from "../../_mov/form-lancamento";
import { formatarDia } from "@/lib/financeiro/dia";

/**
 * A FICHA DO LANÇAMENTO (RN-028). Aqui a lojista vê tudo que aconteceu com
 * aquele dinheiro — inclusive o que deu errado: baixa estornada continua na
 * tela, riscada, com quem estornou. É isso que permite explicar o extrato
 * três meses depois.
 */

type Baixa = {
  id: string;
  data: string;
  valor: number;
  desconto: number;
  juros: number;
  movimentado: number;
  conta: string;
  autorNome: string;
  observacao: string | null;
  estornada: boolean;
  estornoAutor: string | null;
};

type Parcela = {
  id: string;
  numero: number;
  vencimento: string;
  valor: number;
  abatido: number;
  saldo: number;
  conta: string | null;
  forma: string;
  status: StatusParcela;
  baixas: Baixa[];
};

/** Como a origem automática aparece para a lojista (RN-031). */
function rotuloOrigem(origem: string): string {
  if (origem === "ETIQUETA") return "compra de etiqueta";
  if (origem === "PEDIDO") return "venda";
  return origem.toLowerCase();
}

const CORES: Record<StatusParcela, string> = {
  ATRASADA: "bg-rose-50 text-rose-700 ring-rose-200",
  VENCE_HOJE: "bg-amber-50 text-amber-700 ring-amber-200",
  PENDENTE: "bg-sky-50 text-sky-700 ring-sky-200",
  PARCIAL: "bg-violet-50 text-violet-700 ring-violet-200",
  QUITADA: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CANCELADA: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function FichaLancamento({
  hoje,
  contas,
  categorias,
  fornecedores,
  centros,
  colecoes,
  impedimentoEdicao,
  paraEditar,
  lancamento,
  parcelas,
  anexos,
  eventos,
}: {
  hoje: string;
  contas: { id: string; nome: string; padrao: boolean }[];
  categorias: Opcao[];
  fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
  centros: Opcao[];
  colecoes: Opcao[];
  impedimentoEdicao: string | null;
  paraEditar: LancamentoParaEditar;
  lancamento: {
    id: string;
    tipo: string;
    descricao: string;
    documento: string | null;
    competencia: string;
    valor: number;
    observacoes: string | null;
    origem: string;
    origemId: string | null;
    cancelado: boolean;
    pessoa: string | null;
    categoria: string | null;
    centroCusto: string | null;
    colecao: string | null;
  };
  parcelas: Parcela[];
  anexos: { id: string; fileName: string; autorNome: string; quando: string }[];
  eventos: { id: string; descricao: string; autorNome: string; quando: string }[];
}) {
  const router = useRouter();
  const receita = lancamento.tipo === "RECEITA";
  const [baixando, setBaixando] = useState<Parcela | null>(null);
  const [editando, setEditando] = useState(false);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const voltarPara = receita ? "/financeiro/contas-a-receber" : "/financeiro/contas-a-pagar";
  const totalPago = parcelas.reduce((s, p) => s + p.abatido, 0);
  const totalFalta = parcelas.reduce((s, p) => s + p.saldo, 0);

  async function chamar(url: string, method: string, body?: unknown) {
    setOcupado(true);
    setErro("");
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      setOcupado(false);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setOcupado(false);
      setErro("Sem conexão — confira a internet e tente de novo");
      return false;
    }
  }

  async function anexar(file: File) {
    if (file.size > 4_000_000) {
      setErro("Arquivo grande demais (máximo ~4 MB)");
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) {
      setErro("Não consegui ler o arquivo");
      return;
    }
    await chamar(`/api/financeiro/lancamentos/${lancamento.id}/anexos`, "POST", {
      fileName: file.name,
      arquivo: dataUrl,
    });
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title={lancamento.descricao}
        subtitle={`${receita ? "Conta a receber" : "Conta a pagar"} · emitida em ${formatarDia(
          lancamento.competencia
        )}${lancamento.documento ? ` · doc. ${lancamento.documento}` : ""}`}
        action={
          <Link
            href={voltarPara}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        }
      />

      {lancamento.cancelado && (
        <div className="mb-4 rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-600">
          Este lançamento está <b>cancelado</b> — ele não entra em nenhuma soma.
        </div>
      )}
      {erro && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Valor</p>
              <p className="text-lg font-semibold tabular-nums">{brl(lancamento.valor)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                {receita ? "Recebido" : "Pago"}
              </p>
              <p className="text-lg font-semibold tabular-nums text-emerald-700">
                {brl(totalPago)}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Falta</p>
              <p className="text-lg font-semibold tabular-nums">{brl(totalFalta)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">
                {receita ? "Cliente" : "Fornecedor"}
              </p>
              <p className="text-sm font-medium text-slate-700">
                {lancamento.pessoa ?? "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            <span>Categoria: {lancamento.categoria ?? "—"}</span>
            {lancamento.centroCusto && <span>Centro de custo: {lancamento.centroCusto}</span>}
            {lancamento.colecao && <span>Coleção: {lancamento.colecao}</span>}
            {lancamento.origem !== "MANUAL" && (
              <span className="font-medium text-slate-600">
                {lancamento.origem === "PEDIDO" && lancamento.origemId ? (
                  <>
                    Veio da venda —{" "}
                    <Link
                      href={`/pedidos/${lancamento.origemId}`}
                      className="text-brand-700 hover:underline"
                    >
                      abrir o pedido
                    </Link>{" "}
                    (o valor é o dele)
                  </>
                ) : (
                  <>Origem: {rotuloOrigem(lancamento.origem)} — o valor vem da venda</>
                )}
              </span>
            )}
          </div>
          {lancamento.observacoes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              {lancamento.observacoes}
            </p>
          )}

          <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-800">Parcelas</h2>
          <div className="space-y-3">
            {parcelas.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">
                    {p.numero}/{parcelas.length} · vence {formatarDia(p.vencimento)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CORES[p.status]}`}
                  >
                    {STATUS_LABEL[p.status]}
                  </span>
                  <span className="ml-auto tabular-nums font-semibold">{brl(p.valor)}</span>
                  {!lancamento.cancelado && p.saldo > 0 && (
                    <button
                      type="button"
                      onClick={() => setBaixando(p)}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      <CircleDollarSign className="size-3.5" />
                      {receita ? "Recebi" : "Paguei"}
                    </button>
                  )}
                </div>
                {p.saldo > 0 && p.abatido > 0 && (
                  <p className="mt-1 text-xs text-violet-700">
                    Pago {brl(p.abatido)} — ainda faltam {brl(p.saldo)}
                  </p>
                )}
                {p.baixas.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                    {p.baixas.map((b) => (
                      <li
                        key={b.id}
                        className={`flex flex-wrap items-center gap-2 text-xs ${
                          b.estornada ? "text-slate-400" : "text-slate-600"
                        }`}
                      >
                        <span className={b.estornada ? "line-through" : ""}>
                          {formatarDia(b.data)} · {brl(b.movimentado)} em {b.conta}
                          {b.desconto > 0 && ` (desc. ${brl(b.desconto)})`}
                          {b.juros > 0 && ` (juros ${brl(b.juros)})`}
                        </span>
                        <span className="text-slate-400">por {b.autorNome}</span>
                        {b.observacao && !b.estornada && (
                          <span className="text-slate-400">— {b.observacao}</span>
                        )}
                        {b.estornada ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium">
                            estornada{b.estornoAutor ? ` por ${b.estornoAutor}` : ""}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() =>
                              chamar(`/api/financeiro/baixas/${b.id}`, "PATCH", {
                                estornar: true,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-rose-700"
                          >
                            <Undo2 className="size-3" /> estornar
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Paperclip className="size-4" /> Anexos
            </h2>
            <input
              ref={arquivoRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) anexar(f);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={ocupado}
              onClick={() => arquivoRef.current?.click()}
            >
              Anexar arquivo
            </Button>
            <ul className="mt-3 space-y-2">
              {anexos.length === 0 && (
                <li className="text-xs text-slate-400">
                  Nenhum anexo. Guarde aqui o boleto e o comprovante.
                </li>
              )}
              {anexos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-xs">
                  <a
                    href={`/api/financeiro/anexos/${a.id}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-slate-700 hover:text-brand-700"
                  >
                    <Download className="size-3.5 shrink-0" />
                    <span className="truncate">{a.fileName}</span>
                  </a>
                  <button
                    type="button"
                    disabled={ocupado}
                    title="Remover anexo"
                    onClick={() => chamar(`/api/financeiro/anexos/${a.id}`, "DELETE")}
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Histórico</h2>
            <ul className="space-y-2.5">
              {eventos.map((e) => (
                <li key={e.id} className="text-xs">
                  <p className="text-slate-700">{e.descricao}</p>
                  <p className="text-slate-400">
                    {e.autorNome} ·{" "}
                    {new Date(e.quando).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Este lançamento</h2>
            <p className="mb-3 text-xs text-slate-500">
              Nada aqui se apaga. Cancelar tira das somas e mantém o histórico —
              e só é possível depois de estornar as baixas.
            </p>
            <div className="flex flex-wrap gap-2">
              {!lancamento.cancelado &&
                (impedimentoEdicao ? (
                  <p className="text-xs text-slate-500">{impedimentoEdicao}</p>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={ocupado}
                    onClick={() => setEditando(true)}
                  >
                    <Pencil className="size-4" /> Editar
                  </Button>
                ))}
              <Button
                size="sm"
                variant={lancamento.cancelado ? "secondary" : "danger"}
                disabled={ocupado}
                onClick={() =>
                  chamar(`/api/financeiro/lancamentos/${lancamento.id}`, "PATCH", {
                    cancelar: !lancamento.cancelado,
                  })
                }
              >
                {lancamento.cancelado ? (
                  <>
                    <RotateCcw className="size-4" /> Reabrir lançamento
                  </>
                ) : (
                  <>
                    <Ban className="size-4" /> Cancelar lançamento
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {editando && (
        <FormLancamento
          tipo={receita ? "RECEITA" : "DESPESA"}
          hoje={hoje}
          contas={contas}
          categorias={categorias}
          fornecedores={fornecedores}
          centros={centros}
          colecoes={colecoes}
          editando={paraEditar}
          onFechar={() => setEditando(false)}
          onSalvo={() => {
            setEditando(false);
            router.refresh();
          }}
        />
      )}

      {baixando && (
        <BaixaModal
          linha={{
            parcelaId: baixando.id,
            descricao: lancamento.descricao,
            saldo: baixando.saldo,
            numero: baixando.numero,
          }}
          tipo={receita ? "RECEITA" : "DESPESA"}
          hoje={hoje}
          contas={contas}
          onFechar={() => setBaixando(null)}
          onSalvo={() => {
            setBaixando(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
