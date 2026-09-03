"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, EyeOff, Landmark, Plus, Search, Upload } from "lucide-react";
import { Button, Card, Input, PageHeader } from "@/components/ui";
import { StatTile } from "@/components/charts";
import { brl } from "@/lib/format";
import { formatarDia } from "@/lib/financeiro/dia";
import {
  combinaComALinha,
  ordenarCandidatas,
} from "@/lib/financeiro/conciliacao-tela";
import type { LinhaDoBanco, PainelConciliacao } from "@/lib/financeiro/conciliacao";
import { FormLancamento, type Opcao } from "../_mov/form-lancamento";

type Importacao = {
  id: string;
  arquivo: string;
  banco: string | null;
  linhas: number;
  novas: number;
  dia: string;
  autorNome: string;
};

/**
 * CONCILIAÇÃO (RN-037): o extrato do banco de um lado, os lançamentos da loja
 * do outro. A lojista marca os dois lados; a conciliação só fecha quando os
 * totais batem — o "quase igual" é o erro que esta tela existe para achar.
 */
export function ConciliacaoView({
  contas,
  filtro,
  contaEhCartao,
  painel,
  hoje,
  ficha,
  importacoes,
}: {
  contas: { id: string; nome: string }[];
  filtro: { conta: string; aba: "pendente" | "conciliado" | "ignorado"; de: string; ate: string };
  /** conta de CARTÃO não recebe baixa (RN-039): a tela não oferece "Lançar" */
  contaEhCartao: boolean;
  painel: PainelConciliacao;
  hoje: string;
  /** as listas da ficha do lançamento, para criar direto da linha do banco */
  ficha: {
    contas: {
      id: string;
      nome: string;
      padrao: boolean;
      tipo: string;
      diaFechamento: number | null;
      diaVencimento: number | null;
    }[];
    categorias: (Opcao & { tipo: string })[];
    fornecedores: { id: string; nome: string; categoriaPadraoId: string | null }[];
    centros: Opcao[];
    colecoes: Opcao[];
  };
  importacoes: Importacao[];
}) {
  const router = useRouter();
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [criandoDe, setCriandoDe] = useState<LinhaDoBanco | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);

  function aplicar(mudanca: Partial<typeof filtro>) {
    const novo = { ...filtro, ...mudanca };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(novo)) if (v) p.set(k, String(v));
    router.push(`?${p.toString()}`);
  }

  const linhaSelecionada = painel.linhas.find((l) => l.id === linhaAberta);
  const somaMarcada =
    Math.round(
      painel.candidatas
        .filter((c) => marcadas.includes(c.id))
        .reduce((s, c) => s + c.valor, 0) * 100
    ) / 100;
  const diferenca = linhaSelecionada
    ? Math.round((linhaSelecionada.valor - somaMarcada) * 100) / 100
    : 0;

  /**
   * A MAIOR PARTE DOS RECEBIMENTOS É VENDA DO SISTEMA, e achar a venda certa
   * numa lista de 200 baixas era o trabalho manual que sobrava. Então, com uma
   * linha do banco escolhida, sobem para o topo as que COMBINAM com ela —
   * mesmo valor e data pertinho, a mesma régua do casamento automático — e a
   * busca acha pelo nome da cliente ou pelo número do pedido.
   */
  const combina = (c: (typeof painel.candidatas)[number]) =>
    !!linhaSelecionada && combinaComALinha(c, linhaSelecionada);
  const candidatas = ordenarCandidatas(
    painel.candidatas,
    linhaSelecionada ?? null,
    busca,
    marcadas
  );

  async function enviarArquivo(arquivo: File) {
    setOcupado(true);
    setErro("");
    setAviso("");
    const dados = new FormData();
    dados.set("arquivo", arquivo);
    dados.set("contaId", filtro.conta);
    try {
      const res = await fetch("/api/financeiro/conciliacao/importar", {
        method: "POST",
        body: dados,
      });
      const d = await res.json().catch(() => null);
      setOcupado(false);
      if (!res.ok) {
        setErro(d?.error ?? "Não consegui ler este arquivo");
        return;
      }
      setAviso(
        `${d.novas} movimento(s) novo(s) do banco` +
          (d.repetidas > 0 ? `, ${d.repetidas} já estavam aqui` : "") +
          (d.casadas > 0 ? ` — ${d.casadas} casaram sozinho(s) 🎉` : "")
      );
      // linha que o arquivo trazia e não deu para ler é DITA: calada, a
      // lojista fecharia a conferência com o extrato divergindo
      if (d.descartadas > 0)
        setErro(
          `${d.descartadas} linha(s) do arquivo não puderam ser lidas e ficaram de fora — confira o extrato no banco.`
        );
      router.refresh();
    } catch {
      setOcupado(false);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  async function acao(linhaId: string, corpo: Record<string, unknown>) {
    setOcupado(true);
    setErro("");
    setAviso("");
    try {
      const res = await fetch(`/api/financeiro/conciliacao/${linhaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => null);
      setOcupado(false);
      if (!res.ok) {
        setErro(d?.error ?? "Não deu certo — tente de novo");
        return;
      }
      setLinhaAberta(null);
      setMarcadas([]);
      router.refresh();
    } catch {
      setOcupado(false);
      setErro("Sem conexão — confira a internet e tente de novo");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Conferir com o banco"
        subtitle="O extrato que o banco exportou de um lado, o que a loja registrou do outro — para saber se bate."
        action={
          <Link
            href="/financeiro"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Financeiro
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Do banco, a conferir"
          value={String(painel.resumo.pendentes)}
          icon={<Landmark />}
          tone={painel.resumo.pendentes > 0 ? "warn" : "good"}
        />
        <StatTile
          label="Já conferidos"
          value={String(painel.resumo.conciliadas)}
          icon={<CheckCircle2 />}
        />
        <StatTile
          label="Fora do sistema"
          value={String(painel.resumo.ignoradas)}
          icon={<EyeOff />}
        />
        <StatTile
          label="No sistema, sem extrato"
          value={String(painel.resumo.semExtrato)}
          hint="registrado aqui e não achado no banco"
        />
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-500">
            Conta
            <select
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filtro.conta}
              onChange={(e) => aplicar({ conta: e.target.value })}
            >
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500">
            De
            <Input
              type="date"
              className="mt-1 !py-2"
              value={filtro.de}
              onChange={(e) => aplicar({ de: e.target.value })}
            />
          </label>
          <label className="text-xs text-slate-500">
            Até
            <Input
              type="date"
              className="mt-1 !py-2"
              value={filtro.ate}
              onChange={(e) => aplicar({ ate: e.target.value })}
            />
          </label>
          <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
            <Upload className="size-4" />
            {ocupado ? "Lendo…" : "Subir extrato (OFX)"}
            <input
              type="file"
              accept=".ofx,.OFX,text/plain,application/x-ofx"
              className="hidden"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void enviarArquivo(f);
              }}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          O arquivo OFX é o &quot;extrato para outro programa&quot; do app do
          seu banco. Subir o mesmo arquivo duas vezes não duplica nada.
        </p>
      </Card>

      {erro && (
        <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {aviso}
        </p>
      )}

      <div className="mb-3 flex gap-1 text-sm">
        {(
          [
            ["pendente", `A conferir (${painel.resumo.pendentes})`],
            ["conciliado", `Conferidos (${painel.resumo.conciliadas})`],
            ["ignorado", `Fora do sistema (${painel.resumo.ignoradas})`],
          ] as const
        ).map(([v, rotulo]) => (
          <button
            key={v}
            onClick={() => {
              setLinhaAberta(null);
              setMarcadas([]);
              aplicar({ aba: v });
            }}
            className={`rounded-xl px-3.5 py-2 font-medium ${
              filtro.aba === v
                ? "bg-brand-600 text-white"
                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            O que o banco mostra
          </h2>
          {painel.linhas.length === 0 ? (
            <p className="text-sm text-slate-400">
              {filtro.aba === "pendente"
                ? "Nada a conferir neste período — ou o extrato ainda não foi subido."
                : "Nada por aqui neste período."}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {painel.linhas.map((l) => (
                <li key={l.id} className="py-2.5">
                  <button
                    onClick={() => {
                      setMarcadas([]);
                      setLinhaAberta(linhaAberta === l.id ? null : l.id);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50 ${
                      linhaAberta === l.id ? "bg-brand-50/60 ring-1 ring-brand-200" : ""
                    }`}
                  >
                    <span className="text-xs text-slate-400 tabular-nums">
                      {formatarDia(l.dia)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {l.descricao}
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        l.valor < 0 ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {brl(l.valor)}
                    </span>
                  </button>

                  {l.conciliada && (
                    <div className="mt-1 pl-2 text-xs text-slate-500">
                      {l.automatica && <span className="mr-1">✨ casou sozinho ·</span>}
                      {l.lancamentos.map((v) => (
                        <Link
                          key={v.baixaId}
                          href={`/financeiro/lancamentos/${v.lancamentoId}`}
                          className="mr-2 hover:underline"
                        >
                          {v.descricao} ({brl(v.valor)})
                        </Link>
                      ))}
                      <button
                        onClick={() => acao(l.id, { acao: "desconciliar" })}
                        disabled={ocupado}
                        className="text-brand-700 hover:underline"
                      >
                        desfazer
                      </button>
                    </div>
                  )}

                  {linhaAberta === l.id && !l.conciliada && (
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="mb-2 text-xs text-slate-500">
                        Marque no lado direito o que é este dinheiro — pode ser
                        mais de um (um depósito que pagou duas contas). Marcado:{" "}
                        <b className="text-slate-700">{brl(somaMarcada)}</b> de{" "}
                        <b className="text-slate-700">{brl(l.valor)}</b>
                        {diferenca === 0 ? (
                          <b className="text-emerald-700"> — bateu! ✅</b>
                        ) : (
                          <>
                            , faltam <b className="text-slate-700">{brl(diferenca)}</b>.
                          </>
                        )}
                        {marcadas.length === 0 && (
                          <>
                            {" "}
                            Não achou? Lance na hora, no botão abaixo.
                          </>
                        )}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          onClick={() =>
                            acao(l.id, { acao: "conciliar", baixaIds: marcadas })
                          }
                          disabled={ocupado || marcadas.length === 0 || diferenca !== 0}
                        >
                          Conferir
                        </Button>
                        {/* linha "fora do sistema" não vira lançamento: a
                            ficha inteira preenchida só para levar 409 no
                            salvar é a pior forma de dizer não */}
                        {!l.ignorada && !contaEhCartao && (
                          <button
                            onClick={() => setCriandoDe(l)}
                            disabled={ocupado}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Plus className="size-4" />
                            {l.valor > 0 ? "Lançar este recebimento" : "Lançar este pagamento"}
                          </button>
                        )}
                        <button
                          onClick={() => acao(l.id, { acao: "ignorar", ignorar: !l.ignorada })}
                          disabled={ocupado}
                          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        >
                          {l.ignorada ? "Voltar para a fila" : "Não é do sistema"}
                        </button>
                      </div>
                    </div>
                  )}

                  {l.ignorada && linhaAberta !== l.id && (
                    <button
                      onClick={() => acao(l.id, { acao: "ignorar", ignorar: false })}
                      disabled={ocupado}
                      className="mt-1 pl-2 text-xs text-brand-700 hover:underline"
                    >
                      voltar para a fila
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">
            O que a loja registrou
          </h2>
          <p className="mb-3 text-xs text-slate-400">
            Recebimentos e pagamentos JÁ registrados nesta conta e ainda não
            conferidos com o extrato — a venda que você marcou como paga
            aparece aqui.
          </p>
          {painel.candidatas.length > 0 && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pelo nome da cliente ou nº do pedido"
                className="!py-2 !pl-9"
              />
            </div>
          )}
          {painel.candidatas.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nada registrado nesta conta esperando conferência. Se o dinheiro
              do banco existe mas não está aqui, abra a linha à esquerda e use
              &quot;Lançar&quot;.
            </p>
          ) : candidatas.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhum lançamento com &quot;{busca}&quot;.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {candidatas.map((c) => (
                <li key={c.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-2 py-2.5 hover:bg-slate-50 ${
                      marcadas.includes(c.id) ? "bg-brand-50/60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      disabled={!linhaAberta}
                      checked={marcadas.includes(c.id)}
                      onChange={(e) =>
                        setMarcadas((m) =>
                          e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)
                        )
                      }
                    />
                    <span className="text-xs text-slate-400 tabular-nums">
                      {formatarDia(c.dia)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                      {combina(c) && (
                        <span
                          className="mr-1 text-emerald-700"
                          title="Mesmo valor e data pertinho da linha escolhida"
                        >
                          ✨
                        </span>
                      )}
                      {c.descricao}
                      {c.pessoa && (
                        <span className="text-slate-400"> · {c.pessoa}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-sm font-semibold tabular-nums ${
                        c.valor < 0 ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {brl(c.valor)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!linhaAberta && painel.candidatas.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Escolha primeiro uma linha do banco, à esquerda.
            </p>
          )}
        </Card>
      </div>

      {criandoDe && (
        <FormLancamento
          tipo={criandoDe.valor > 0 ? "RECEITA" : "DESPESA"}
          hoje={hoje}
          contas={ficha.contas}
          categorias={ficha.categorias.filter(
            (c) => c.tipo === (criandoDe.valor > 0 ? "RECEITA" : "DESPESA")
          )}
          fornecedores={ficha.fornecedores}
          centros={ficha.centros}
          colecoes={ficha.colecoes}
          daLinhaDoBanco={{
            linhaId: criandoDe.id,
            // o schema do lançamento para em 160 (RN-030): o memo do banco
            // vem cortado, senão a ficha voltaria "Dados inválidos" sem motivo
            descricao: criandoDe.descricao.slice(0, 160),
            valor: criandoDe.valor,
            dia: criandoDe.dia,
            contaId: filtro.conta,
          }}
          onFechar={() => setCriandoDe(null)}
          onSalvo={(r) => {
            setCriandoDe(null);
            setLinhaAberta(null);
            setMarcadas([]);
            setErro("");
            const falta = Number(r?.falta ?? 0);
            setAviso(
              r?.conciliada
                ? "Lançamento criado, baixado e conferido com o extrato. ✅"
                : `Lançamento criado e baixado. Ele cobre parte desta linha do banco (faltam ${brl(
                    falta
                  )}): abra a linha, marque à direita os lançamentos que completam e clique em Conferir.`
            );
            router.refresh();
          }}
        />
      )}

      {importacoes.length > 0 && (
        <Card className="mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Extratos subidos
          </h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {importacoes.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-xs text-slate-400 tabular-nums">
                  {formatarDia(i.dia)}
                </span>
                <span className="font-medium text-slate-700">{i.arquivo}</span>
                {i.banco && <span className="text-xs text-slate-400">{i.banco}</span>}
                <span className="ml-auto text-xs text-slate-500">
                  {i.linhas} movimento(s), {i.novas} novo(s) · por {i.autorNome}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
