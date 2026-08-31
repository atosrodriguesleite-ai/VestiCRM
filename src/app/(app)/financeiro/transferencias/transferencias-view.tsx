"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, Plus } from "lucide-react";
import { Button, Card, Field, Input, PageHeader, inputCls } from "@/components/ui";
import { brl } from "@/lib/format";
import { numeroBR } from "@/lib/numero-br";
import { formatarDia } from "../_mov/lista";

/**
 * TRANSFERÊNCIAS (RN-030). As DUAS datas são o detalhe que faz o extrato
 * bater: a TED sai hoje e cai amanhã, e cada conta vê o dinheiro no seu dia.
 */

type Transferencia = {
  id: string;
  valor: number;
  dataSaida: string;
  dataEntrada: string;
  origem: string;
  destino: string;
  descricao: string | null;
  autorNome: string;
  cancelada: boolean;
  canceladaPor: string | null;
};

export function TransferenciasView({
  hoje,
  contas,
  transferencias,
}: {
  hoje: string;
  contas: { id: string; nome: string }[];
  transferencias: Transferencia[];
}) {
  const router = useRouter();
  const [criando, setCriando] = useState(false);
  const [origem, setOrigem] = useState(contas[0]?.id ?? "");
  const [destino, setDestino] = useState(contas[1]?.id ?? "");
  const [valor, setValor] = useState("");
  const [saida, setSaida] = useState(hoje);
  const [entrada, setEntrada] = useState(hoje);
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const v = numeroBR(valor);
    if (!v || v <= 0) {
      setErro("Informe o valor (ex.: 1.500,00)");
      return;
    }
    if (origem === destino) {
      setErro("Escolha duas contas diferentes");
      return;
    }
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch("/api/financeiro/transferencias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contaOrigemId: origem,
          contaDestinoId: destino,
          valor: v,
          dataSaida: saida,
          dataEntrada: entrada,
          descricao: descricao.trim() || null,
        }),
      });
      setSalvando(false);
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return;
      }
      setCriando(false);
      setValor("");
      setDescricao("");
      router.refresh();
    } catch {
      setSalvando(false);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  async function cancelar(t: Transferencia) {
    try {
      const res = await fetch(`/api/financeiro/transferencias/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelar: true }),
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
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Transferências"
        subtitle="Dinheiro entre as contas da própria loja. Não é receita nem despesa — só muda de lugar."
        action={
          <div className="flex gap-2">
            <Link
              href="/financeiro/extrato"
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Extrato
            </Link>
            {!criando && contas.length >= 2 && (
              <Button onClick={() => setCriando(true)}>
                <Plus className="size-4" /> Nova transferência
              </Button>
            )}
          </div>
        }
      />

      {contas.length < 2 && (
        <Card className="mb-4 p-5 text-sm text-slate-600">
          Para transferir é preciso ter pelo menos duas contas cadastradas.{" "}
          <Link href="/financeiro/cadastros" className="font-medium text-brand-700 hover:underline">
            Cadastrar contas
          </Link>
        </Card>
      )}

      {criando && (
        <Card className="mb-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sai da conta">
              <select className={inputCls} value={origem} onChange={(e) => setOrigem(e.target.value)}>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </Field>
            <Field label="Entra na conta">
              <select className={inputCls} value={destino} onChange={(e) => setDestino(e.target.value)}>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </Field>
            <Field label="Valor (R$)">
              <Input inputMode="decimal" placeholder="1.500,00" value={valor} onChange={(e) => setValor(e.target.value)} />
            </Field>
            <Field label="Descrição (opcional)">
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Saque para o caixa" />
            </Field>
            <Field label="Saiu em" hint="O dia em que o dinheiro deixou a conta de origem">
              <Input type="date" value={saida} onChange={(e) => { setSaida(e.target.value); if (entrada < e.target.value) setEntrada(e.target.value); }} />
            </Field>
            <Field label="Caiu em" hint="O dia em que entrou na conta de destino (pode ser o mesmo)">
              <Input type="date" value={entrada} onChange={(e) => setEntrada(e.target.value)} />
            </Field>
          </div>
          {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
          <div className="mt-4 flex gap-2">
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Registrar transferência"}
            </Button>
            <Button variant="secondary" onClick={() => setCriando(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {erro && !criando && <p className="mb-3 text-sm text-rose-600">{erro}</p>}

      <Card className="divide-y divide-slate-100">
        {transferencias.length === 0 && (
          <p className="p-5 text-sm text-slate-500">
            Nenhuma transferência ainda.
          </p>
        )}
        {transferencias.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className={`flex items-center gap-2 text-sm font-medium ${t.cancelada ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {t.origem} <ArrowRight className="size-3.5 text-slate-400" /> {t.destino}
              </p>
              <p className="text-xs text-slate-500">
                Saiu {formatarDia(t.dataSaida)} · caiu {formatarDia(t.dataEntrada)} · por {t.autorNome}
                {t.descricao ? ` — ${t.descricao}` : ""}
                {t.cancelada && t.canceladaPor ? ` · cancelada por ${t.canceladaPor}` : ""}
              </p>
            </div>
            <span className={`tabular-nums font-semibold ${t.cancelada ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {brl(t.valor)}
            </span>
            {!t.cancelada && (
              <button
                type="button"
                onClick={() => cancelar(t)}
                title="Cancelar transferência"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
              >
                <Ban className="size-4" />
              </button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
