"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Landmark,
  FolderTree,
  Factory,
  Briefcase,
  Shirt,
  Plus,
  Pencil,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button, Card, Field, Input, PageHeader, inputCls } from "@/components/ui";
import { brl } from "@/lib/format";
import { formatarCnpj, formatarCpf } from "@/lib/documento";
import { numeroBR } from "@/lib/numero-br";

/** Dia de HOJE no fuso de São Paulo (UTC−3) — o do servidor/UTC vira
 *  "amanhã" depois das 21h e o saldo inicial nasceria um dia no futuro. */
function hojeSP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * FINANCEIRO · CADASTROS (RN-029) — cinco abas, um princípio: cadastro não
 * se apaga, se ARQUIVA (os botões refletem isso; DELETE nem existe na API).
 * Clientes ficam de fora de propósito: o financeiro usa a ficha do CRM.
 */

type Conta = {
  id: string;
  nome: string;
  tipo: string;
  saldoInicial: number;
  saldoInicialEm: string;
  cor: string;
  padrao: boolean;
  arquivada: boolean;
  // cartão de crédito (RN-039)
  diaFechamento: number | null;
  diaVencimento: number | null;
  contaPagamentoId: string | null;
};
type Categoria = {
  id: string;
  nome: string;
  tipo: string;
  codigo: string;
  paiId: string | null;
  sistema: boolean;
  arquivada: boolean;
};
type Centro = { id: string; nome: string; arquivado: boolean };
type Colecao = {
  id: string;
  nome: string;
  inicio: string | null;
  fim: string | null;
  arquivada: boolean;
};
type Fornecedor = {
  id: string;
  nome: string;
  razaoSocial: string | null;
  cnpj: string | null;
  cpf: string | null;
  ie: string | null;
  telefone: string | null;
  email: string | null;
  chavePix: string | null;
  dadosBancarios: string | null;
  observacoes: string | null;
  categoriaPadraoId: string | null;
  categoriaPadraoNome: string | null;
  arquivado: boolean;
};

const ABAS = [
  { key: "contas", label: "Contas", icon: Landmark },
  { key: "categorias", label: "Categorias", icon: FolderTree },
  { key: "fornecedores", label: "Fornecedores", icon: Factory },
  { key: "centros", label: "Centros de custo", icon: Briefcase },
  { key: "colecoes", label: "Coleções", icon: Shirt },
] as const;

type AbaKey = (typeof ABAS)[number]["key"];

const TIPO_CONTA: Record<string, string> = {
  BANCO: "Banco",
  CAIXINHA: "Caixinha (dinheiro)",
  DIGITAL: "Conta digital",
  POUPANCA: "Poupança",
  CARTAO: "Cartão de crédito",
};

async function chamar(
  url: string,
  method: "POST" | "PATCH",
  body: unknown
): Promise<{ ok: boolean; erro?: string; dados?: Record<string, unknown> }> {
  // rede fora do ar não pode travar o botão em "Salvando…" (o fetch REJEITA)
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok)
      return { ok: true, dados: (await res.json().catch(() => null)) ?? undefined };
    const data = await res.json().catch(() => null);
    return { ok: false, erro: data?.error ?? "Não deu certo — tente de novo" };
  } catch {
    return { ok: false, erro: "Sem conexão — confira a internet e tente de novo" };
  }
}

export function CadastrosView(props: {
  contas: Conta[];
  categorias: Categoria[];
  centros: Centro[];
  colecoes: Colecao[];
  fornecedores: Fornecedor[];
}) {
  const [aba, setAba] = useState<AbaKey>("contas");

  return (
    <div>
      <PageHeader
        title="Cadastros do Financeiro"
        subtitle="A fundação do módulo: contas, categorias, fornecedores, centros de custo e coleções. Nada aqui se apaga — se arquiva, para o histórico nunca quebrar."
        action={
          <Link
            href="/financeiro"
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" /> Voltar ao Financeiro
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {ABAS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => setAba(a.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              aba === a.key
                ? "bg-brand-600 text-white shadow-xs"
                : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300"
            }`}
          >
            <a.icon className="size-4" /> {a.label}
          </button>
        ))}
      </div>

      {aba === "contas" && <AbaContas iniciais={props.contas} />}
      {aba === "categorias" && <AbaCategorias iniciais={props.categorias} />}
      {aba === "fornecedores" && (
        <AbaFornecedores
          iniciais={props.fornecedores}
          categorias={props.categorias}
        />
      )}
      {aba === "centros" && <AbaCentros iniciais={props.centros} />}
      {aba === "colecoes" && <AbaColecoes iniciais={props.colecoes} />}
    </div>
  );
}

/* ---- Contas ---------------------------------------------------------- */

function AbaContas({ iniciais }: { iniciais: Conta[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Conta | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("BANCO");
  const [saldo, setSaldo] = useState("0");
  const [saldoEm, setSaldoEm] = useState(hojeSP());
  const [cor, setCor] = useState("#0E8A5F");
  const [padrao, setPadrao] = useState(false);
  const [repescando, setRepescando] = useState(false);
  // cartão de crédito (RN-039): os dias que decidem a fatura de cada compra
  const [fechamento, setFechamento] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [contaPagamento, setContaPagamento] = useState("");
  const ehCartao = tipo === "CARTAO";
  const contas = iniciais;

  function abrirForm(c: Conta | null) {
    setErro("");
    setEditando(c);
    setCriando(!c);
    setNome(c?.nome ?? "");
    setTipo(c?.tipo ?? "BANCO");
    setSaldo(String(c?.saldoInicial ?? 0));
    setSaldoEm(c ? c.saldoInicialEm.slice(0, 10) : hojeSP());
    setCor(c?.cor ?? "#0E8A5F");
    setPadrao(c?.padrao ?? false);
    setFechamento(c?.diaFechamento ? String(c.diaFechamento) : "");
    setVencimento(c?.diaVencimento ? String(c.diaVencimento) : "");
    setContaPagamento(c?.contaPagamentoId ?? "");
  }

  async function salvar() {
    // numeroBR: "1.500" é R$ 1.500 (milhar), não R$ 1,50 — o parseFloat cru
    // já gravou dinheiro 1000× menor em outro canto do app (17/08/2026)
    const valor = numeroBR(saldo) ?? (saldo.trim() === "" ? 0 : null);
    if (!nome.trim() || valor === null) {
      setErro("Preencha o nome e um saldo válido (ex.: 1.500,00)");
      return;
    }
    setSalvando(true);
    // o cartão não guarda dinheiro (RN-039): sem saldo inicial e nunca padrão
    const diaF = ehCartao ? Number(fechamento) : NaN;
    const diaV = ehCartao ? Number(vencimento) : NaN;
    if (ehCartao && (!(diaF >= 1 && diaF <= 31) || !(diaV >= 1 && diaV <= 31))) {
      setErro("No cartão, diga o dia em que a fatura fecha e o dia em que vence");
      setSalvando(false);
      return;
    }
    const body = {
      nome: nome.trim(),
      tipo,
      saldoInicial: ehCartao ? 0 : valor,
      saldoInicialEm: saldoEm,
      cor,
      padrao: ehCartao ? false : padrao,
      ...(ehCartao
        ? {
            diaFechamento: diaF,
            diaVencimento: diaV,
            contaPagamentoId: contaPagamento || null,
          }
        : { diaFechamento: null, diaVencimento: null, contaPagamentoId: null }),
    };
    const r = editando
      ? await chamar(`/api/financeiro/contas/${editando.id}`, "PATCH", body)
      : await chamar("/api/financeiro/contas", "POST", body);
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro ?? "Não deu certo");
      return;
    }
    setCriando(false);
    setEditando(null);
    // RN-033: escolher a conta padrão acerta as vendas pagas que ficaram sem
    // baixa por falta dela. O trabalho vai no after() do servidor, então a
    // tela NÃO promete um número — dizer "50 vendas baixadas" com 87 ainda
    // na fila seria pior que não dizer nada
    setRepescando(Boolean(r.dados?.repescando));
    router.refresh();
  }

  async function arquivar(c: Conta) {
    const r = await chamar(`/api/financeiro/contas/${c.id}`, "PATCH", {
      arquivar: !c.arquivada,
    });
    // falha silenciosa vira "o botão não funciona" (lição da RN-010) — diz
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    router.refresh();
  }

  const formAberto = criando || editando !== null;

  return (
    <div className="space-y-4">
      {!formAberto && (
        <Button size="sm" onClick={() => abrirForm(null)}>
          <Plus className="size-4" /> Nova conta
        </Button>
      )}
      {!formAberto && erro && <p className="text-sm text-rose-600">{erro}</p>}
      {repescando && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Pronto! Esta é a conta onde o dinheiro das vendas entra. As vendas
          que já estavam pagas e esperando estão sendo baixadas aqui — elas
          saem do &quot;atrasado&quot; conforme você usa o Financeiro.
        </p>
      )}

      {formAberto && (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">
            {editando ? "Editar conta" : "Nova conta"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome da conta">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Banco Inter, Caixinha da loja…"
              />
            </Field>
            <Field label="Tipo">
              <select
                className={inputCls}
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
              >
                {Object.entries(TIPO_CONTA).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            {ehCartao ? (
              <>
                <Field
                  label="Dia em que a fatura FECHA"
                  hint="Compra feita a partir deste dia já vai para a fatura seguinte"
                >
                  <Input
                    inputMode="numeric"
                    value={fechamento}
                    onChange={(e) => setFechamento(e.target.value)}
                    placeholder="28"
                  />
                </Field>
                <Field label="Dia em que a fatura VENCE">
                  <Input
                    inputMode="numeric"
                    value={vencimento}
                    onChange={(e) => setVencimento(e.target.value)}
                    placeholder="5"
                  />
                </Field>
                <Field
                  label="Conta que paga a fatura"
                  hint="De onde o dinheiro sai quando a fatura é paga"
                >
                  <select
                    className={inputCls}
                    value={contaPagamento}
                    onChange={(e) => setContaPagamento(e.target.value)}
                  >
                    <option value="">— escolher depois —</option>
                    {contas
                      .filter((c) => c.tipo !== "CARTAO" && !c.arquivada)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field
                  label="Saldo inicial (R$)"
                  hint="O extrato desta conta começa a contar a partir daqui"
                >
                  <Input
                    inputMode="decimal"
                    value={saldo}
                    onChange={(e) => setSaldo(e.target.value)}
                  />
                </Field>
                <Field label="Data do saldo inicial">
                  <Input
                    type="date"
                    value={saldoEm}
                    onChange={(e) => setSaldoEm(e.target.value)}
                  />
                </Field>
              </>
            )}
            <Field label="Cor de identificação">
              <input
                type="color"
                value={cor}
                onChange={(e) => setCor(e.target.value)}
                className="h-10 w-16 cursor-pointer rounded-lg border border-slate-200"
              />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={padrao}
                onChange={(e) => setPadrao(e.target.checked)}
              />
              Conta sugerida nos lançamentos novos
            </label>
          </div>
          {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCriando(false);
                setEditando(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      <Card className="divide-y divide-slate-100">
        {iniciais.length === 0 && (
          <p className="p-5 text-sm text-slate-500">
            Nenhuma conta ainda. Comece pelo banco onde o dinheiro da loja cai.
          </p>
        )}
        {iniciais.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: c.cor }}
            />
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${c.arquivada ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {c.nome}
                {c.padrao && !c.arquivada && (
                  <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    padrão
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {TIPO_CONTA[c.tipo] ?? c.tipo} · saldo inicial {brl(c.saldoInicial)}
              </p>
            </div>
            {!c.arquivada && (
              <button
                type="button"
                onClick={() => abrirForm(c)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Editar"
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => arquivar(c)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={c.arquivada ? "Reativar" : "Arquivar"}
            >
              {c.arquivada ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---- Categorias ------------------------------------------------------- */

function AbaCategorias({ iniciais }: { iniciais: Categoria[] }) {
  const router = useRouter();
  const [novoEm, setNovoEm] = useState<string | "RECEITA" | "DESPESA" | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [renomeando, setRenomeando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    if (!novoNome.trim() || novoEm === null) return;
    setSalvando(true);
    const raiz = novoEm === "RECEITA" || novoEm === "DESPESA";
    const r = await chamar("/api/financeiro/categorias", "POST", {
      nome: novoNome.trim(),
      ...(raiz ? { tipo: novoEm } : { paiId: novoEm }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro ?? "Não deu certo");
      return;
    }
    setNovoEm(null);
    setNovoNome("");
    setErro("");
    router.refresh();
  }

  async function renomear(id: string) {
    if (!nomeEditado.trim()) return;
    const r = await chamar(`/api/financeiro/categorias/${id}`, "PATCH", {
      nome: nomeEditado.trim(),
    });
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    setRenomeando(null);
    router.refresh();
  }

  async function arquivar(c: Categoria) {
    const r = await chamar(`/api/financeiro/categorias/${c.id}`, "PATCH", {
      arquivar: !c.arquivada,
    });
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    router.refresh();
  }

  // função (e não componente): componente definido aqui dentro remontaria a
  // cada render e o campo de texto perderia o foco a cada tecla
  function renderBloco(tipo: "RECEITA" | "DESPESA", titulo: string) {
    const doTipo = iniciais.filter((c) => c.tipo === tipo);
    return (
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
          <Button size="sm" variant="secondary" onClick={() => { setNovoEm(tipo); setNovoNome(""); }}>
            <Plus className="size-4" /> Grupo novo
          </Button>
        </div>
        <div className="space-y-1">
          {doTipo.map((c) => {
            const nivel = c.codigo.split(".").length;
            return (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                style={{ paddingLeft: `${(nivel - 1) * 22 + 8}px` }}
              >
                <span className="w-14 shrink-0 font-mono text-[11px] text-slate-400">
                  {c.codigo}
                </span>
                {renomeando === c.id ? (
                  <span className="flex flex-1 items-center gap-2">
                    <Input
                      className="!py-1.5 text-sm"
                      value={nomeEditado}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => renomear(c.id)}>
                      Ok
                    </Button>
                  </span>
                ) : (
                  <span
                    className={`flex-1 text-sm ${
                      c.arquivada
                        ? "text-slate-400 line-through"
                        : nivel === 1
                          ? "font-semibold text-slate-800"
                          : "text-slate-700"
                    }`}
                  >
                    {c.nome}
                  </span>
                )}
                {!c.arquivada && (
                  <>
                    <button
                      type="button"
                      title="Categoria dentro desta"
                      onClick={() => { setNovoEm(c.id); setNovoNome(""); }}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Renomear"
                      onClick={() => { setRenomeando(c.id); setNomeEditado(c.nome); }}
                      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  title={c.arquivada ? "Reativar" : "Arquivar"}
                  onClick={() => arquivar(c)}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {c.arquivada ? (
                    <ArchiveRestore className="size-3.5" />
                  ) : (
                    <Archive className="size-3.5" />
                  )}
                </button>
                {novoEm === c.id && (
                  <FormNovaCategoria
                    nome={novoNome}
                    setNome={setNovoNome}
                    onOk={criar}
                    onCancel={() => setNovoEm(null)}
                    salvando={salvando}
                  />
                )}
              </div>
            );
          })}
        </div>
        {novoEm === tipo && (
          <div className="mt-3">
            <FormNovaCategoria
              nome={novoNome}
              setNome={setNovoNome}
              onOk={criar}
              onCancel={() => setNovoEm(null)}
              salvando={salvando}
            />
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        A árvore já vem pronta para loja de moda — renomeie e crie as suas. O
        número é o sistema quem dá, e categoria criada dentro de um grupo herda
        se é receita ou despesa (é o que mantém o DRE honesto).
      </p>
      {erro && <p className="text-sm text-rose-600">{erro}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {renderBloco("RECEITA", "Receitas — de onde o dinheiro vem")}
        {renderBloco("DESPESA", "Despesas — para onde o dinheiro vai")}
      </div>
    </div>
  );
}

function FormNovaCategoria({
  nome,
  setNome,
  onOk,
  onCancel,
  salvando,
}: {
  nome: string;
  setNome: (v: string) => void;
  onOk: () => void;
  onCancel: () => void;
  salvando: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      <Input
        className="!py-1.5 text-sm"
        placeholder="Nome da categoria"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onOk()}
        autoFocus
      />
      <Button size="sm" onClick={onOk} disabled={salvando}>
        Criar
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </span>
  );
}

/* ---- Fornecedores ----------------------------------------------------- */

function AbaFornecedores({
  iniciais,
  categorias,
}: {
  iniciais: Fornecedor[];
  categorias: Categoria[];
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<Fornecedor | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const categoriasDespesa = categorias.filter(
    (c) => c.tipo === "DESPESA" && !c.arquivada
  );

  function abrirForm(f: Fornecedor | null) {
    setErro("");
    setEditando(f);
    setCriando(!f);
    setForm({
      nome: f?.nome ?? "",
      razaoSocial: f?.razaoSocial ?? "",
      cnpj: f?.cnpj ? formatarCnpj(f.cnpj) : "",
      cpf: f?.cpf ? formatarCpf(f.cpf) : "",
      ie: f?.ie ?? "",
      telefone: f?.telefone ?? "",
      email: f?.email ?? "",
      chavePix: f?.chavePix ?? "",
      dadosBancarios: f?.dadosBancarios ?? "",
      observacoes: f?.observacoes ?? "",
      categoriaPadraoId: f?.categoriaPadraoId ?? "",
    });
  }

  const campo = (k: string) => ({
    value: form[k] ?? "",
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => setForm((s) => ({ ...s, [k]: e.target.value })),
  });

  async function salvar() {
    if (!form.nome?.trim()) {
      setErro("O nome é obrigatório — é como a loja chama o fornecedor");
      return;
    }
    setSalvando(true);
    const body = {
      nome: form.nome.trim(),
      razaoSocial: form.razaoSocial || null,
      cnpj: form.cnpj || null,
      cpf: form.cpf || null,
      ie: form.ie || null,
      telefone: form.telefone || null,
      email: form.email || null,
      chavePix: form.chavePix || null,
      dadosBancarios: form.dadosBancarios || null,
      observacoes: form.observacoes || null,
      categoriaPadraoId: form.categoriaPadraoId || null,
    };
    const r = editando
      ? await chamar(`/api/financeiro/fornecedores/${editando.id}`, "PATCH", body)
      : await chamar("/api/financeiro/fornecedores", "POST", body);
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro ?? "Não deu certo");
      return;
    }
    setCriando(false);
    setEditando(null);
    router.refresh();
  }

  async function arquivar(f: Fornecedor) {
    const r = await chamar(`/api/financeiro/fornecedores/${f.id}`, "PATCH", {
      arquivar: !f.arquivado,
    });
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    router.refresh();
  }

  const formAberto = criando || editando !== null;

  return (
    <div className="space-y-4">
      {!formAberto && (
        <Button size="sm" onClick={() => abrirForm(null)}>
          <Plus className="size-4" /> Novo fornecedor
        </Button>
      )}
      {!formAberto && erro && <p className="text-sm text-rose-600">{erro}</p>}

      {formAberto && (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-800">
            {editando ? "Editar fornecedor" : "Novo fornecedor"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" hint="Como a loja o chama no dia a dia">
              <Input placeholder="Facção da Dona Cida" {...campo("nome")} />
            </Field>
            <Field label="Razão social (opcional)">
              <Input {...campo("razaoSocial")} />
            </Field>
            <Field label="CNPJ">
              <Input placeholder="00.000.000/0000-00" {...campo("cnpj")} />
            </Field>
            <Field label="CPF" hint="Preencha um dos dois — ou nenhum">
              <Input placeholder="000.000.000-00" {...campo("cpf")} />
            </Field>
            <Field label="Inscrição estadual" hint="Só vale junto do CNPJ">
              <Input {...campo("ie")} />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input {...campo("telefone")} />
            </Field>
            <Field label="E-mail">
              <Input type="email" {...campo("email")} />
            </Field>
            <Field label="Chave Pix">
              <Input {...campo("chavePix")} />
            </Field>
            <Field label="Dados bancários" hint="Banco, agência e conta — anotação para pagar">
              <Input {...campo("dadosBancarios")} />
            </Field>
            <Field
              label="Categoria padrão"
              hint="Toda conta deste fornecedor já nasce etiquetada assim"
            >
              <select className={inputCls} {...campo("categoriaPadraoId")}>
                <option value="">— sem categoria padrão —</option>
                {categoriasDespesa.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.codigo} · {c.nome}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Observações">
                <textarea className={`${inputCls} min-h-20`} {...campo("observacoes")} />
              </Field>
            </div>
          </div>
          {erro && <p className="mt-3 text-sm text-rose-600">{erro}</p>}
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setCriando(false);
                setEditando(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </Card>
      )}

      <Card className="divide-y divide-slate-100">
        {iniciais.length === 0 && (
          <p className="p-5 text-sm text-slate-500">
            Nenhum fornecedor ainda. Cadastre quem a loja paga: tecido, facção,
            aluguel, embalagem…
          </p>
        )}
        {iniciais.map((f) => (
          <div key={f.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${f.arquivado ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {f.nome}
              </p>
              <p className="truncate text-xs text-slate-500">
                {[
                  f.cnpj ? formatarCnpj(f.cnpj) : f.cpf ? formatarCpf(f.cpf) : null,
                  f.telefone,
                  f.categoriaPadraoNome,
                ]
                  .filter(Boolean)
                  .join(" · ") || "sem documento"}
              </p>
            </div>
            {!f.arquivado && (
              <button
                type="button"
                onClick={() => abrirForm(f)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Editar"
              >
                <Pencil className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => arquivar(f)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={f.arquivado ? "Reativar" : "Arquivar"}
            >
              {f.arquivado ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---- Centros de custo -------------------------------------------------- */

function AbaCentros({ iniciais }: { iniciais: Centro[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function criar() {
    if (!nome.trim()) return;
    setSalvando(true);
    const r = await chamar("/api/financeiro/centros-custo", "POST", {
      nome: nome.trim(),
    });
    setSalvando(false);
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    if (r.ok) setNome("");
    router.refresh();
  }

  async function arquivar(c: Centro) {
    const r = await chamar(`/api/financeiro/centros-custo/${c.id}`, "PATCH", {
      arquivar: !c.arquivado,
    });
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Para quem tem mais de uma “frente” (loja física, online, uma segunda
        marca). Opcional — sem centros, nada muda.
      </p>
      <div className="flex max-w-md gap-2">
        <Input
          placeholder="Loja física, Online…"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && criar()}
        />
        <Button size="sm" onClick={criar} disabled={salvando}>
          <Plus className="size-4" /> Criar
        </Button>
      </div>
      {erro && <p className="text-sm text-rose-600">{erro}</p>}
      <Card className="divide-y divide-slate-100">
        {iniciais.length === 0 && (
          <p className="p-5 text-sm text-slate-500">Nenhum centro de custo.</p>
        )}
        {iniciais.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            <p className={`flex-1 text-sm font-medium ${c.arquivado ? "text-slate-400 line-through" : "text-slate-800"}`}>
              {c.nome}
            </p>
            <button
              type="button"
              onClick={() => arquivar(c)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={c.arquivado ? "Reativar" : "Arquivar"}
            >
              {c.arquivado ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---- Coleções ---------------------------------------------------------- */

function AbaColecoes({ iniciais }: { iniciais: Colecao[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function criar() {
    if (!nome.trim()) return;
    setSalvando(true);
    const r = await chamar("/api/financeiro/colecoes", "POST", {
      nome: nome.trim(),
      inicio: inicio || null,
      fim: fim || null,
    });
    setSalvando(false);
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    if (r.ok) {
      setNome("");
      setInicio("");
      setFim("");
    }
    router.refresh();
  }

  async function arquivar(c: Colecao) {
    const r = await chamar(`/api/financeiro/colecoes/${c.id}`, "PATCH", {
      arquivar: !c.arquivada,
    });
    setErro(r.ok ? "" : r.erro ?? "Não deu certo — tente de novo");
    router.refresh();
  }

  const periodo = (c: Colecao) => {
    const f = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString("pt-BR") : null;
    const i = f(c.inicio);
    const t = f(c.fim);
    if (i && t) return `${i} → ${t}`;
    if (i) return `desde ${i}`;
    return "sem período";
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Etiquete receitas e despesas pela coleção e responda, no fim dela:
        “o Inverno 2026 deu lucro?”
      </p>
      <div className="grid max-w-2xl gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input
          placeholder="Inverno 2026"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
        <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} title="Começo" />
        <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} title="Fim" />
        <Button size="sm" onClick={criar} disabled={salvando}>
          <Plus className="size-4" /> Criar
        </Button>
      </div>
      {erro && <p className="text-sm text-rose-600">{erro}</p>}
      <Card className="divide-y divide-slate-100">
        {iniciais.length === 0 && (
          <p className="p-5 text-sm text-slate-500">Nenhuma coleção ainda.</p>
        )}
        {iniciais.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${c.arquivada ? "text-slate-400 line-through" : "text-slate-800"}`}>
                {c.nome}
              </p>
              <p className="text-xs text-slate-500">{periodo(c)}</p>
            </div>
            <button
              type="button"
              onClick={() => arquivar(c)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={c.arquivada ? "Reativar" : "Arquivar"}
            >
              {c.arquivada ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              )}
            </button>
          </div>
        ))}
      </Card>
    </div>
  );
}
