"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Portal } from "@/components/portal";
import { Button, Field, Input, inputCls } from "@/components/ui";
import { brl } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import { round2 } from "@/lib/orders";

/**
 * DAR BAIXA (RN-028) — o dinheiro andou.
 *
 * A tela separa três números de propósito, porque somá-los antes de gravar é
 * o que faz o extrato divergir do banco: o que ABATE da parcela, o desconto
 * concedido e os juros cobrados. O que entra/sai da conta aparece embaixo,
 * calculado na hora, para a lojista conferir com o extrato do banco.
 */

export function BaixaModal({
  linha,
  tipo,
  hoje,
  contas,
  onFechar,
  onSalvo,
}: {
  linha: { parcelaId: string; descricao: string; saldo: number; numero: number };
  tipo: "RECEITA" | "DESPESA";
  hoje: string;
  contas: { id: string; nome: string; padrao: boolean }[];
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const receita = tipo === "RECEITA";
  const [contaId, setContaId] = useState(
    contas.find((c) => c.padrao)?.id ?? contas[0]?.id ?? ""
  );
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState(linha.saldo.toFixed(2).replace(".", ","));
  const [desconto, setDesconto] = useState("");
  const [juros, setJuros] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const movimentado = useMemo(
    () =>
      round2(
        (numeroBR(valor) ?? 0) - (numeroBR(desconto) ?? 0) + (numeroBR(juros) ?? 0)
      ),
    [valor, desconto, juros]
  );
  const restaDepois = round2(Math.max(0, linha.saldo - (numeroBR(valor) ?? 0)));

  async function salvar() {
    const v = numeroBR(valor);
    if (!contaId) {
      setErro("Escolha a conta — é ela que mostra o dinheiro no extrato");
      return;
    }
    if (v === null || v <= 0) {
      setErro("Informe o valor (ex.: 1.500,00)");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(
        `/api/financeiro/parcelas/${linha.parcelaId}/baixas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contaId,
            data,
            valor: v,
            desconto: numeroBR(desconto) ?? 0,
            juros: numeroBR(juros) ?? 0,
            observacao: observacao.trim() || null,
          }),
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
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
        <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl">
          <div className="mb-1 flex items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {receita ? "Registrar recebimento" : "Registrar pagamento"}
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
          <p className="mb-4 text-sm text-slate-500">
            {linha.descricao} · parcela {linha.numero} · falta{" "}
            <b className="text-slate-700">{brl(linha.saldo)}</b>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={receita ? "Caiu na conta" : "Saiu da conta"}>
              <select
                className={inputCls}
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
              >
                {contas.length === 0 && <option value="">Cadastre uma conta</option>}
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data">
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </Field>
            <Field label="Valor da baixa (R$)" hint="Quanto abate da parcela">
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto">
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                />
              </Field>
              <Field label="Juros/multa">
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={juros}
                  onChange={(e) => setJuros(e.target.value)}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Observação (opcional)">
                <Input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Pix da titular, pago em dinheiro…"
                />
              </Field>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
            <p>
              {receita ? "Entra" : "Sai"} da conta:{" "}
              <b className="text-slate-900">{brl(movimentado)}</b>
            </p>
            <p className="text-slate-500">
              {restaDepois > 0
                ? `Depois desta baixa ainda faltam ${brl(restaDepois)} nesta parcela.`
                : "Esta baixa quita a parcela."}
            </p>
          </div>

          {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}

          <div className="mt-5 flex gap-2">
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : receita ? "Confirmar recebimento" : "Confirmar pagamento"}
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
