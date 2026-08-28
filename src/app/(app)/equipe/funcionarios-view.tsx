"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Plus,
  Search,
  ChevronDown,
  ChevronUp,
  Phone,
  Cake,
  HeartPulse,
  FileText,
  Download,
  Trash2,
  Archive,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Check,
  Link2,
} from "lucide-react";
import { Card, Avatar } from "@/components/ui";
import { brl, dateFull, formatPhone, numeroBR } from "@/lib/format";
import { casaTexto } from "@/lib/busca";
import { copiarTexto } from "@/lib/copiar";
import {
  vinculoLabel,
  periodicidadeLabel,
  formaPagamentoLabel,
  docTipoLabel,
  rotuloCampoFicha,
  BENEFICIOS,
  documentosFaltantes,
  situacaoDoDocumento,
  type FichaBasica,
} from "@/lib/funcionarios";
import type {
  FuncionarioVinculo,
  FuncionarioDocTipo,
  PeriodicidadePagamento,
  FormaPagamentoFuncionario,
} from "@prisma/client";

/**
 * FICHAS DE FUNCIONÁRIO (RN-025) — a seção de RH da tela Equipe.
 *
 * Registro da EMPRESA, sem vínculo com os logins da seção de cima: a maior
 * parte dos funcionários (costureira, diarista, facção) nunca entra no
 * sistema. Quem decide o que aparece é a API: ADMIN recebe a ficha inteira;
 * GERENTE recebe só o básico + emergência/alergias — os campos que ele não
 * pode ver nem chegam ao navegador.
 *
 * Ficha NUNCA é apagada: desligar arquiva (com data e motivo) e a ficha vai
 * para o grupo "Desligados", dobrado no fim da lista.
 */

type Dependente = { id: string; nome: string; nascimento: string | null };
type Documento = {
  id: string;
  tipo: FuncionarioDocTipo;
  fileName: string;
  validade: string | null;
  dependenteId: string | null;
  createdAt: string;
};
type Evento = { id: string; descricao: string; autorNome: string; createdAt: string };
// resposta do formulário do link, aguardando o admin conferir (RN-025)
type RespostaPendente = {
  id: string;
  usadoEm: string;
  resposta: Record<string, unknown> | null;
};

type FichaCompleta = FichaBasica & {
  cpf: string | null;
  email: string | null;
  zip: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  motivoDesligamento: string | null;
  remuneracao: number;
  periodicidade: PeriodicidadePagamento;
  formaPagamento: FormaPagamentoFuncionario;
  chavePix: string | null;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  beneficios: string[];
  observacoes: string | null;
  dependentes: Dependente[];
  documentos: Documento[];
  eventos: Evento[];
  formLinks: RespostaPendente[];
};

const VAZIA: Partial<FichaCompleta> = {
  nome: "",
  vinculo: "INFORMAL",
  periodicidade: "MENSAL",
  formaPagamento: "PIX",
  beneficios: [],
};

export function FuncionariosSecao({ souAdmin }: { souAdmin: boolean }) {
  const [carregando, setCarregando] = useState(true);
  const [admin, setAdmin] = useState(souAdmin);
  const [fichas, setFichas] = useState<(FichaBasica | FichaCompleta)[]>([]);
  const [busca, setBusca] = useState("");
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [editando, setEditando] = useState<Partial<FichaCompleta> | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mostrarDesligados, setMostrarDesligados] = useState(false);

  async function recarregar() {
    const res = await fetch("/api/funcionarios").catch(() => null);
    if (res?.ok) {
      const d = await res.json();
      setAdmin(d.admin);
      setFichas(d.funcionarios);
    }
    setCarregando(false);
  }
  useEffect(() => {
    void recarregar();
  }, []);

  const { ativas, desligadas } = useMemo(() => {
    const filtradas = fichas.filter(
      (f) => casaTexto(f.nome, busca) || casaTexto(f.cargo, busca)
    );
    return {
      ativas: filtradas.filter((f) => !f.desligamento),
      desligadas: filtradas.filter((f) => f.desligamento),
    };
  }, [fichas, busca]);

  // documentos vencendo/vencidos em toda a equipe (só o admin recebe docs)
  const alertaDocs = useMemo(() => {
    let vencidos = 0,
      vencendo = 0;
    for (const f of fichas) {
      if (!("documentos" in f) || f.desligamento) continue;
      for (const d of (f as FichaCompleta).documentos) {
        const s = situacaoDoDocumento(d.validade);
        if (s === "VENCIDO") vencidos++;
        else if (s === "VENCENDO") vencendo++;
      }
    }
    return { vencidos, vencendo };
  }, [fichas]);

  async function salvarFicha() {
    if (!editando?.nome?.trim()) {
      setErro("A ficha precisa pelo menos do nome.");
      return;
    }
    setSalvando(true);
    setErro("");
    // monta o corpo SÓ com o que a API aceita — relações e desligamento têm
    // rotas próprias, e mandar campo a mais deixaria o zod recusar a ficha
    const f = editando as FichaCompleta & { id?: string };
    const id = f.id;
    const corpo = {
      nome: f.nome, fotoUrl: f.fotoUrl ?? null, nascimento: f.nascimento ?? null,
      cpf: f.cpf ?? null, telefone: f.telefone ?? null, email: f.email ?? null,
      zip: f.zip ?? null, street: f.street ?? null, streetNumber: f.streetNumber ?? null,
      complement: f.complement ?? null, district: f.district ?? null,
      city: f.city ?? null, state: f.state ?? null, cargo: f.cargo ?? null,
      vinculo: f.vinculo, inicio: f.inicio ?? null,
      remuneracao: f.remuneracao ?? 0, periodicidade: f.periodicidade,
      formaPagamento: f.formaPagamento, chavePix: f.chavePix ?? null,
      banco: f.banco ?? null, agencia: f.agencia ?? null, conta: f.conta ?? null,
      emergenciaNome: f.emergenciaNome ?? null,
      emergenciaParentesco: f.emergenciaParentesco ?? null,
      emergenciaTelefone: f.emergenciaTelefone ?? null,
      restricaoAlimentar: f.restricaoAlimentar ?? null, alergias: f.alergias ?? null,
      beneficios: f.beneficios ?? [], observacoes: f.observacoes ?? null,
    };
    const res = await fetch(id ? `/api/funcionarios/${id}` : "/api/funcionarios", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).catch(() => null);
    setSalvando(false);
    if (!res || !res.ok) {
      setErro((await res?.json().catch(() => ({})))?.error ?? "Não foi possível salvar.");
      return;
    }
    setEditando(null);
    await recarregar();
  }

  async function desligar(f: FichaCompleta, reativar: boolean) {
    const motivo = reativar
      ? null
      : window.prompt(
          `Desligar ${f.nome.split(" ")[0]}? A ficha fica arquivada (nunca é apagada).\nMotivo (opcional):`
        );
    if (!reativar && motivo === null) return; // cancelou o prompt
    const res = await fetch(`/api/funcionarios/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        reativar
          ? { desligamento: null }
          : {
              // o DIA é o de São Paulo, não o UTC: às 22h o registro trabalhista
              // ainda é de hoje — toISOString() já registraria amanhã
              desligamento: new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Sao_Paulo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date()),
              motivoDesligamento: motivo || null,
            }
      ),
    }).catch(() => null);
    if (res?.ok) await recarregar();
  }

  if (carregando)
    return (
      <Card className="mt-8 p-6">
        <p className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="size-4 animate-spin" /> Carregando funcionários…
        </p>
      </Card>
    );

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <Users className="size-5 text-brand-600" />
            Funcionários
          </h2>
          <p className="text-xs text-slate-500">
            Fichas de RH da empresa — independente de quem tem login no sistema.
            {!admin && " Você vê a ficha básica; documentos e salário são do administrador."}
          </p>
        </div>
        {admin && (
          <button
            onClick={() => {
              setEditando({ ...VAZIA });
              setErro("");
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Plus className="size-4" /> Novo funcionário
          </button>
        )}
      </div>

      {admin && (alertaDocs.vencidos > 0 || alertaDocs.vencendo > 0) && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            {alertaDocs.vencidos > 0 && (
              <b>{alertaDocs.vencidos} documento{alertaDocs.vencidos > 1 ? "s" : ""} vencido{alertaDocs.vencidos > 1 ? "s" : ""}</b>
            )}
            {alertaDocs.vencidos > 0 && alertaDocs.vencendo > 0 && " · "}
            {alertaDocs.vencendo > 0 && (
              <>{alertaDocs.vencendo} vencendo nos próximos 30 dias</>
            )}
            {" — confira as fichas marcadas."}
          </span>
        </div>
      )}

      {fichas.length > 3 && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou cargo"
            className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400"
          />
        </div>
      )}

      {ativas.length === 0 && desligadas.length === 0 ? (
        <Card className="p-6 text-center text-sm text-gray-400">
          Nenhum funcionário cadastrado ainda.
          {admin && " Toque em “Novo funcionário” para criar a primeira ficha."}
        </Card>
      ) : (
        <div className="space-y-2">
          {ativas.map((f) => (
            <LinhaFuncionario
              key={f.id}
              ficha={f}
              admin={admin}
              aberta={abertaId === f.id}
              onAbrir={() => setAbertaId(abertaId === f.id ? null : f.id)}
              onEditar={() => {
                setEditando({ ...(f as FichaCompleta) });
                setErro("");
              }}
              onDesligar={(re) => desligar(f as FichaCompleta, re)}
              onMudou={recarregar}
            />
          ))}
          {desligadas.length > 0 && (
            <button
              onClick={() => setMostrarDesligados((v) => !v)}
              className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-gray-200 px-3 py-2 text-xs font-medium text-gray-400 transition hover:text-gray-600"
            >
              {mostrarDesligados ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {desligadas.length} desligado{desligadas.length > 1 ? "s" : ""} (fichas arquivadas)
            </button>
          )}
          {mostrarDesligados &&
            desligadas.map((f) => (
              <LinhaFuncionario
                key={f.id}
                ficha={f}
                admin={admin}
                aberta={abertaId === f.id}
                onAbrir={() => setAbertaId(abertaId === f.id ? null : f.id)}
                onEditar={() => {
                  setEditando({ ...(f as FichaCompleta) });
                  setErro("");
                }}
                onDesligar={(re) => desligar(f as FichaCompleta, re)}
                onMudou={recarregar}
              />
            ))}
        </div>
      )}

      {editando && (
        <FormFicha
          ficha={editando}
          onChange={setEditando}
          onSalvar={salvarFicha}
          onFechar={() => setEditando(null)}
          salvando={salvando}
          erro={erro}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function LinhaFuncionario({
  ficha,
  admin,
  aberta,
  onAbrir,
  onEditar,
  onDesligar,
  onMudou,
}: {
  ficha: FichaBasica | FichaCompleta;
  admin: boolean;
  aberta: boolean;
  onAbrir: () => void;
  onEditar: () => void;
  onDesligar: (reativar: boolean) => void;
  onMudou: () => void;
}) {
  const f = ficha as FichaCompleta;
  const desligada = Boolean(ficha.desligamento);
  const aguardando = admin && "formLinks" in ficha ? f.formLinks.length : 0;
  const docsProblema =
    admin && "documentos" in ficha
      ? f.documentos.filter((d) => situacaoDoDocumento(d.validade) !== "OK" && d.validade)
          .length
      : 0;

  return (
    <Card className={`overflow-hidden ${desligada ? "opacity-70" : ""}`}>
      <button
        onClick={onAbrir}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
      >
        <Avatar name={ficha.nome} color="#0d9488" src={ficha.fotoUrl} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-semibold text-slate-800">{ficha.nome}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
              {vinculoLabel[ficha.vinculo]}
            </span>
            {desligada && (
              <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                Desligado
              </span>
            )}
            {docsProblema > 0 && !desligada && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <AlertTriangle className="size-3" /> {docsProblema} doc.
              </span>
            )}
            {aguardando > 0 && (
              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                ficha enviada — conferir
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-gray-400">
            {[ficha.cargo, ficha.inicio ? `desde ${dateFull(ficha.inicio)}` : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </span>
        </span>
        {aberta ? (
          <ChevronUp className="size-4 shrink-0 text-gray-300" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-gray-300" />
        )}
      </button>

      {aberta && (
        <div className="border-t border-gray-100 px-4 py-3 text-sm">
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {ficha.telefone && (
              <Info icone={<Phone className="size-3.5" />} rotulo="Telefone">
                {formatPhone(ficha.telefone)}
              </Info>
            )}
            {ficha.nascimento && (
              <Info icone={<Cake className="size-3.5" />} rotulo="Nascimento">
                {dateFull(ficha.nascimento)}
              </Info>
            )}
            {(ficha.emergenciaNome || ficha.emergenciaTelefone) && (
              <Info icone={<HeartPulse className="size-3.5" />} rotulo="Emergência">
                {[
                  ficha.emergenciaNome,
                  ficha.emergenciaParentesco ? `(${ficha.emergenciaParentesco})` : null,
                  ficha.emergenciaTelefone ? formatPhone(ficha.emergenciaTelefone) : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Info>
            )}
            {(ficha.restricaoAlimentar || ficha.alergias) && (
              <Info icone={<HeartPulse className="size-3.5" />} rotulo="Saúde">
                {[
                  ficha.restricaoAlimentar ? `Restrição: ${ficha.restricaoAlimentar}` : null,
                  ficha.alergias ? `Alergias: ${ficha.alergias}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Info>
            )}
            {admin && "remuneracao" in ficha && f.remuneracao > 0 && (
              <Info rotulo="Remuneração">
                {brl(f.remuneracao)} {periodicidadeLabel[f.periodicidade]} ·{" "}
                {formaPagamentoLabel[f.formaPagamento]}
                {f.formaPagamento === "PIX" && f.chavePix ? ` (${f.chavePix})` : ""}
              </Info>
            )}
            {desligada && (
              <Info rotulo="Desligamento">
                {dateFull(ficha.desligamento!)}
                {admin && f.motivoDesligamento ? ` — ${f.motivoDesligamento}` : ""}
              </Info>
            )}
          </div>

          {admin && "formLinks" in ficha && f.formLinks.length > 0 && (
            <ConferenciaPendente ficha={f} onMudou={onMudou} />
          )}

          {admin && "documentos" in ficha && (
            <DocumentosDaFicha ficha={f} onMudou={onMudou} />
          )}

          {admin && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              <button
                onClick={onEditar}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-brand-300 hover:text-brand-700"
              >
                Editar ficha
              </button>
              {!desligada && <BotaoLinkFormulario fichaId={ficha.id} />}
              {desligada ? (
                <button
                  onClick={() => onDesligar(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-300"
                >
                  <RotateCcw className="size-3.5" /> Reativar
                </button>
              ) : (
                <button
                  onClick={() => onDesligar(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-rose-300 hover:text-rose-600"
                >
                  <Archive className="size-3.5" /> Desligar (arquiva a ficha)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * Botão "Link do formulário" (RN-025): gera o link de uso único e já deixa a
 * MENSAGEM PRONTA na área de transferência — o admin só cola no WhatsApp do
 * funcionário.
 */
function BotaoLinkFormulario({ fichaId }: { fichaId: string }) {
  const [estado, setEstado] = useState<"quieto" | "gerando" | "copiado" | "erro">("quieto");

  async function gerar() {
    setEstado("gerando");
    const r = await fetch(`/api/funcionarios/${fichaId}/form-link`, { method: "POST" }).catch(
      () => null
    );
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (!d?.mensagem) {
      setEstado("erro");
      setTimeout(() => setEstado("quieto"), 3000);
      return;
    }
    const copiou = await copiarTexto(d.mensagem);
    setEstado(copiou ? "copiado" : "erro");
    setTimeout(() => setEstado("quieto"), 3000);
    // navegador que recusa a área de transferência não pode ENGOLIR o link:
    // o admin ainda precisa dele para mandar ao funcionário
    if (!copiou) window.prompt("Copie a mensagem com o link:", d.mensagem);
  }

  return (
    <button
      onClick={gerar}
      disabled={estado === "gerando"}
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-sky-300 hover:text-sky-700 disabled:opacity-60"
    >
      {estado === "copiado" ? (
        <>
          <Check className="size-3.5 text-emerald-600" /> Mensagem copiada!
        </>
      ) : estado === "erro" ? (
        "Não deu — tente de novo"
      ) : (
        <>
          <Link2 className="size-3.5" />
          {estado === "gerando" ? "Gerando…" : "Link do formulário"}
        </>
      )}
    </button>
  );
}

/**
 * O funcionário enviou a ficha pelo link e a resposta AGUARDA CONFERÊNCIA
 * (RN-025): o admin vê campo a campo o que veio e decide — aprovar grava na
 * ficha (só o que veio preenchido), dispensar descarta. Documento anexado
 * pelo link já está na pasta acima.
 */
function ConferenciaPendente({ ficha, onMudou }: { ficha: FichaCompleta; onMudou: () => void }) {
  const [agindo, setAgindo] = useState(false);
  const [erro, setErro] = useState("");

  async function decidir(linkId: string, aprovar: boolean) {
    if (!aprovar && !window.confirm("Dispensar a resposta? Nada será gravado na ficha."))
      return;
    setAgindo(true);
    setErro("");
    const r = await fetch(`/api/funcionarios/${ficha.id}/conferir`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ linkId, aprovar }),
    }).catch(() => null);
    setAgindo(false);
    if (!r || !r.ok) {
      setErro((await r?.json().catch(() => ({})))?.error ?? "Não foi possível concluir.");
      return;
    }
    onMudou();
  }

  // a foto vira "foto nova" e as datas saem à brasileira: o admin confere
  // gente, não JSON
  const valorLegivel = (k: string, v: unknown): string => {
    const dataBR = (t: string) => t.slice(0, 10).split("-").reverse().join("/");
    if (k === "fotoUrl") return "foto nova";
    if (k === "dependentes" && Array.isArray(v))
      return v
        .map((item) => {
          const dep = item as { nome?: string; nascimento?: string | null };
          return `${dep.nome ?? "?"}${dep.nascimento ? ` (${dataBR(String(dep.nascimento))})` : ""}`;
        })
        .join("; ");
    if (k === "nascimento" && typeof v === "string") return dataBR(v);
    return String(v);
  };

  return (
    <div className="mt-3 space-y-2">
      {ficha.formLinks.map((l) => (
        <div key={l.id} className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="mb-1.5 text-xs font-semibold text-sky-800">
            📋 {ficha.nome.split(" ")[0]} enviou a ficha pelo link em {dateFull(l.usadoEm)} —
            aguardando sua conferência
          </p>
          <ul className="mb-2 space-y-0.5">
            {Object.entries(l.resposta ?? {}).map(([k, v]) => (
              <li key={k} className="text-xs text-slate-700">
                <span className="text-gray-500">{rotuloCampoFicha[k] ?? k}:</span>{" "}
                <b>{valorLegivel(k, v)}</b>
              </li>
            ))}
          </ul>
          {erro && <p className="mb-2 text-xs text-rose-600">{erro}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => decidir(l.id, true)}
              disabled={agindo}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
            >
              Aprovar e gravar na ficha
            </button>
            <button
              onClick={() => decidir(l.id, false)}
              disabled={agindo}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-rose-300 hover:text-rose-600 disabled:opacity-60"
            >
              Dispensar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Info({
  icone,
  rotulo,
  children,
}: {
  icone?: React.ReactNode;
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-start gap-1.5 text-slate-600">
      <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        {icone}
        {rotulo}:
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/* ------------------------- documentos (só admin) ------------------------- */

function DocumentosDaFicha({ ficha, onMudou }: { ficha: FichaCompleta; onMudou: () => void }) {
  const [anexando, setAnexando] = useState(false);
  const [tipo, setTipo] = useState<FuncionarioDocTipo>("RG");
  const [validade, setValidade] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const pendentes = documentosFaltantes(ficha.vinculo, ficha.documentos);

  async function anexar(file: File) {
    if (file.size > 4 * 1024 * 1024) {
      setErro("Arquivo grande demais (máximo ~4 MB). Tire a foto em qualidade normal.");
      return;
    }
    setEnviando(true);
    setErro("");
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const resp = await fetch(`/api/funcionarios/${ficha.id}/documentos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo,
        fileName: file.name,
        arquivo: dataUrl,
        validade: validade || null,
      }),
    }).catch(() => null);
    setEnviando(false);
    if (!resp || !resp.ok) {
      setErro((await resp?.json().catch(() => ({})))?.error ?? "Não foi possível anexar.");
      return;
    }
    setAnexando(false);
    setValidade("");
    onMudou();
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        <FileText className="size-3.5" /> Documentos
        {pendentes.length > 0 && (
          <span className="normal-case font-normal">
            · faltam para {vinculoLabel[ficha.vinculo]}:{" "}
            {pendentes.map((t) => docTipoLabel[t]).join(", ")}
          </span>
        )}
      </p>

      {ficha.documentos.length > 0 && (
        <ul className="mb-2 space-y-1">
          {ficha.documentos.map((d) => {
            const sit = situacaoDoDocumento(d.validade);
            const dep = d.dependenteId
              ? ficha.dependentes.find((x) => x.id === d.dependenteId)
              : null;
            return (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-600">
                  <b>{docTipoLabel[d.tipo]}</b>
                  {dep ? ` (${dep.nome.split(" ")[0]})` : ""} · {d.fileName}
                </span>
                {d.validade && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      sit === "VENCIDO"
                        ? "bg-rose-100 text-rose-700"
                        : sit === "VENCENDO"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {sit === "VENCIDO" ? "vencido" : sit === "VENCENDO" ? "vence em breve" : "válido"}{" "}
                    · {dateFull(d.validade)}
                  </span>
                )}
                <a
                  href={`/api/funcionarios/documentos/${d.id}`}
                  className="shrink-0 rounded p-1 text-gray-400 transition hover:text-brand-700"
                  title="Baixar"
                >
                  <Download className="size-3.5" />
                </a>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Remover este documento (${docTipoLabel[d.tipo]})?`)) return;
                    await fetch(`/api/funcionarios/documentos/${d.id}`, { method: "DELETE" });
                    onMudou();
                  }}
                  className="shrink-0 rounded p-1 text-gray-400 transition hover:text-rose-600"
                  title="Remover"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {anexando ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 p-2.5">
          <label className="text-[11px] font-semibold text-gray-500">
            Tipo
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as FuncionarioDocTipo)}
              className="block rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-normal"
            >
              {Object.entries(docTipoLabel).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] font-semibold text-gray-500">
            Validade (se tiver)
            <input
              type="date"
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
              className="block rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-normal"
            />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Escolher arquivo
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              disabled={enviando}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void anexar(file);
                e.target.value = "";
              }}
            />
          </label>
          <button
            onClick={() => setAnexando(false)}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
          >
            Cancelar
          </button>
          {erro && <p className="w-full text-xs text-rose-600">{erro}</p>}
        </div>
      ) : (
        <button
          onClick={() => setAnexando(true)}
          className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-brand-300 hover:text-brand-700"
        >
          + Anexar documento
        </button>
      )}
    </div>
  );
}

/* --------------------------- formulário (admin) --------------------------- */

function FormFicha({
  ficha,
  onChange,
  onSalvar,
  onFechar,
  salvando,
  erro,
}: {
  ficha: Partial<FichaCompleta>;
  onChange: (f: Partial<FichaCompleta>) => void;
  onSalvar: () => void;
  onFechar: () => void;
  salvando: boolean;
  erro: string;
}) {
  const set = (k: keyof FichaCompleta, v: unknown) => onChange({ ...ficha, [k]: v });
  const soData = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : "");

  // O campo de valor guarda TEXTO e converte ao digitar (numeroBR): input
  // controlado por número comia o separador — "1518," virava "1518" e os
  // centavos eram impossíveis de digitar.
  const [remuneracaoTexto, setRemuneracaoTexto] = useState(
    ficha.remuneracao ? String(ficha.remuneracao).replace(".", ",") : ""
  );

  // CEP preenche o endereço sozinho (ViaCEP), como na ficha de cliente
  async function buscarCep(cep: string) {
    const d = cep.replace(/\D/g, "");
    if (d.length !== 8) return;
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`).catch(() => null);
    const j = r?.ok ? await r.json() : null;
    if (j && !j.erro)
      onChange({
        ...ficha,
        zip: cep,
        street: j.logradouro || ficha.street,
        district: j.bairro || ficha.district,
        city: j.localidade || ficha.city,
        state: j.uf || ficha.state,
      });
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 animate-fade-in sm:items-center sm:p-4"
      onClick={onFechar}
    >
      <div
        className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-semibold text-slate-800">
            {ficha.id ? `Ficha — ${ficha.nome}` : "Novo funcionário"}
          </p>
          <p className="text-[11px] text-gray-400">
            Salário, documentos e dados pessoais: só administradores veem.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Bloco titulo="Identificação">
            <Campo rotulo="Nome completo *">
              <input value={ficha.nome ?? ""} onChange={(e) => set("nome", e.target.value)} className={INPUT} />
            </Campo>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Nascimento">
                <input type="date" value={soData(ficha.nascimento)} onChange={(e) => set("nascimento", e.target.value || null)} className={INPUT} />
              </Campo>
              <Campo rotulo="CPF">
                <input value={ficha.cpf ?? ""} onChange={(e) => set("cpf", e.target.value || null)} placeholder="000.000.000-00" className={INPUT} />
              </Campo>
              <Campo rotulo="WhatsApp">
                <input value={ficha.telefone ?? ""} onChange={(e) => set("telefone", e.target.value || null)} placeholder="(75) 99999-9999" className={INPUT} />
              </Campo>
              <Campo rotulo="E-mail">
                <input value={ficha.email ?? ""} onChange={(e) => set("email", e.target.value || null)} className={INPUT} />
              </Campo>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Campo rotulo="CEP">
                <input
                  value={ficha.zip ?? ""}
                  onChange={(e) => set("zip", e.target.value || null)}
                  onBlur={(e) => void buscarCep(e.target.value)}
                  placeholder="00000-000"
                  className={INPUT}
                />
              </Campo>
              <Campo rotulo="Rua" className="col-span-2">
                <input value={ficha.street ?? ""} onChange={(e) => set("street", e.target.value || null)} className={INPUT} />
              </Campo>
              <Campo rotulo="Número">
                <input value={ficha.streetNumber ?? ""} onChange={(e) => set("streetNumber", e.target.value || null)} className={INPUT} />
              </Campo>
              <Campo rotulo="Bairro">
                <input value={ficha.district ?? ""} onChange={(e) => set("district", e.target.value || null)} className={INPUT} />
              </Campo>
              <Campo rotulo="Cidade / UF">
                <div className="flex gap-1.5">
                  <input value={ficha.city ?? ""} onChange={(e) => set("city", e.target.value || null)} className={INPUT} />
                  <input value={ficha.state ?? ""} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2) || null)} className={`${INPUT} w-14`} />
                </div>
              </Campo>
            </div>
          </Bloco>

          <Bloco titulo="Trabalho">
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Cargo/função">
                <input value={ficha.cargo ?? ""} onChange={(e) => set("cargo", e.target.value || null)} placeholder="Costureira, vendedora…" className={INPUT} />
              </Campo>
              <Campo rotulo="Vínculo">
                <select value={ficha.vinculo ?? "INFORMAL"} onChange={(e) => set("vinculo", e.target.value as FuncionarioVinculo)} className={INPUT}>
                  {Object.entries(vinculoLabel).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Data de início">
                <input type="date" value={soData(ficha.inicio)} onChange={(e) => set("inicio", e.target.value || null)} className={INPUT} />
              </Campo>
            </div>
          </Bloco>

          <Bloco titulo="Remuneração e pagamento">
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Valor (R$)">
                <input
                  inputMode="decimal"
                  value={remuneracaoTexto}
                  onChange={(e) => {
                    setRemuneracaoTexto(e.target.value);
                    set("remuneracao", numeroBR(e.target.value));
                  }}
                  placeholder="1.518,00"
                  className={INPUT}
                />
              </Campo>
              <Campo rotulo="Periodicidade">
                <select value={ficha.periodicidade ?? "MENSAL"} onChange={(e) => set("periodicidade", e.target.value as PeriodicidadePagamento)} className={INPUT}>
                  {Object.entries(periodicidadeLabel).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Forma de pagamento">
                <select value={ficha.formaPagamento ?? "PIX"} onChange={(e) => set("formaPagamento", e.target.value as FormaPagamentoFuncionario)} className={INPUT}>
                  {Object.entries(formaPagamentoLabel).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Campo>
              {ficha.formaPagamento === "PIX" && (
                <Campo rotulo="Chave Pix">
                  <input value={ficha.chavePix ?? ""} onChange={(e) => set("chavePix", e.target.value || null)} className={INPUT} />
                </Campo>
              )}
              {ficha.formaPagamento === "TRANSFERENCIA" && (
                <>
                  <Campo rotulo="Banco">
                    <input value={ficha.banco ?? ""} onChange={(e) => set("banco", e.target.value || null)} className={INPUT} />
                  </Campo>
                  <Campo rotulo="Agência / Conta">
                    <div className="flex gap-1.5">
                      <input value={ficha.agencia ?? ""} onChange={(e) => set("agencia", e.target.value || null)} placeholder="Agência" className={INPUT} />
                      <input value={ficha.conta ?? ""} onChange={(e) => set("conta", e.target.value || null)} placeholder="Conta" className={INPUT} />
                    </div>
                  </Campo>
                </>
              )}
            </div>
          </Bloco>

          <Bloco titulo="Emergência e saúde">
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Contato de emergência">
                <input value={ficha.emergenciaNome ?? ""} onChange={(e) => set("emergenciaNome", e.target.value || null)} placeholder="Nome" className={INPUT} />
              </Campo>
              <Campo rotulo="Parentesco / Telefone">
                <div className="flex gap-1.5">
                  <input value={ficha.emergenciaParentesco ?? ""} onChange={(e) => set("emergenciaParentesco", e.target.value || null)} placeholder="Mãe, esposo…" className={INPUT} />
                  <input value={ficha.emergenciaTelefone ?? ""} onChange={(e) => set("emergenciaTelefone", e.target.value || null)} placeholder="Telefone" className={INPUT} />
                </div>
              </Campo>
              <Campo rotulo="Restrição alimentar">
                <input value={ficha.restricaoAlimentar ?? ""} onChange={(e) => set("restricaoAlimentar", e.target.value || null)} className={INPUT} />
              </Campo>
              <Campo rotulo="Alergias">
                <input value={ficha.alergias ?? ""} onChange={(e) => set("alergias", e.target.value || null)} className={INPUT} />
              </Campo>
            </div>
          </Bloco>

          <Bloco titulo="Benefícios">
            <div className="flex flex-wrap gap-1.5">
              {BENEFICIOS.map((b) => {
                const marcado = (ficha.beneficios ?? []).includes(b);
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() =>
                      set(
                        "beneficios",
                        marcado
                          ? (ficha.beneficios ?? []).filter((x) => x !== b)
                          : [...(ficha.beneficios ?? []), b]
                      )
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      marcado
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-gray-200 text-gray-500 hover:border-brand-300"
                    }`}
                  >
                    {marcado && <Check className="size-3" />}
                    {b}
                  </button>
                );
              })}
            </div>
          </Bloco>

          <Bloco titulo="Observações internas (só administradores)">
            <textarea
              value={ficha.observacoes ?? ""}
              onChange={(e) => set("observacoes", e.target.value || null)}
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </Bloco>
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
          {erro && <p className="min-w-0 flex-1 text-xs text-rose-600">{erro}</p>}
          {!erro && <span className="flex-1" />}
          <button onClick={onFechar} className="rounded-xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            onClick={onSalvar}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {salvando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Salvar ficha
          </button>
        </div>
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-brand-400";

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{titulo}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Campo({
  rotulo,
  children,
  className = "",
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-[11px] font-semibold text-gray-500 ${className}`}>
      {rotulo}
      <span className="mt-0.5 block font-normal">{children}</span>
    </label>
  );
}
