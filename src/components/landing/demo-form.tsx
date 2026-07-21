"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo";
import { IconCheck, IconClose, IconShield } from "./icons";

/**
 * Formulário de solicitação de demonstração (drawer no mobile / modal no
 * desktop). É a ÚNICA porta comercial da Landing Page: não há compra,
 * checkout, cadastro self-service nem teste grátis. Ao enviar, cria um lead
 * no Super Admin via /api/demo → Lead Intake Engine (origem "Site").
 */

const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

const SELLERS = ["1 (só eu)", "2 a 3", "4 a 6", "7 a 10", "Mais de 10"];

type FormState = {
  name: string;
  company: string;
  phone: string;
  email: string;
  city: string;
  state: string;
  instagram: string;
  sellers: string;
  hasPhysical: boolean;
  hasEcommerce: boolean;
  currentSystem: string;
  message: string;
  consent: boolean;
};

const EMPTY: FormState = {
  name: "",
  company: "",
  phone: "",
  email: "",
  city: "",
  state: "",
  instagram: "",
  sellers: "",
  hasPhysical: false,
  hasEcommerce: false,
  currentSystem: "",
  message: "",
  consent: false,
};

const fieldCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10";
const labelCls = "block text-[13px] font-medium text-slate-700 mb-1.5";

function YesNo({
  value,
  onChange,
  name,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  name: string;
}) {
  return (
    <div className="flex gap-2" role="group" aria-label={name}>
      {[
        { v: true, t: "Sim" },
        { v: false, t: "Não" },
      ].map((o) => (
        <button
          key={o.t}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
            value === o.v
              ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15"
              : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
          }`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function DemoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fecha com ESC + trava o scroll do body enquanto aberto
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const valid =
    form.name.trim() &&
    form.company.trim() &&
    form.phone.replace(/\D/g, "").length >= 10 &&
    form.consent;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || status === "sending") return;
    setStatus("sending");
    try {
      // Atribuição: se o visitante chegou por um link marcado (ex.: rodapé
      // "Feito com AtacadoPro" de um catálogo), registra a origem no lead.
      const utm = new URLSearchParams(window.location.search);
      const ref =
        [
          utm.get("utm_source"),
          utm.get("utm_medium"),
          utm.get("utm_campaign"),
        ]
          .filter(Boolean)
          .join(" / ") || undefined;
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent: true, ref }),
      });
      if (!res.ok) throw new Error();
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function close() {
    onClose();
    // reset após a animação de saída
    setTimeout(() => {
      setForm(EMPTY);
      setStatus("idle");
    }, 250);
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4 pb-[var(--kb,0px)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-title"
    >
      {/* backdrop */}
      <button
        aria-label="Fechar"
        onClick={close}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full sm:max-w-xl max-h-[calc(100dvh_-_var(--kb,0px)_-_1.5rem)] overflow-y-auto thin-scroll rounded-t-3xl sm:rounded-3xl bg-white shadow-pop animate-scale-in outline-none"
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/90 backdrop-blur px-5 sm:px-7 py-4">
          <div className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <div className="leading-tight">
              <p id="demo-title" className="text-[15px] font-semibold text-slate-900">
                Solicitar demonstração
              </p>
              <p className="text-xs text-slate-500">
                Atendimento humano e implantação personalizada
              </p>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Fechar"
            className="grid size-9 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {status === "done" ? (
          <div className="px-6 sm:px-8 py-12 text-center">
            <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
              <IconCheck className="size-8" />
            </div>
            <h3 className="text-xl font-semibold text-slate-900">
              Recebemos sua solicitação
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
              Em breve entraremos em contato para agendar sua demonstração.
            </p>
            <button
              onClick={close}
              className="mt-7 inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-5 sm:px-7 py-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="f-name">
                  Nome <span className="text-brand-500">*</span>
                </label>
                <input
                  id="f-name"
                  className={fieldCls}
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Seu nome"
                  required
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-company">
                  Empresa / Loja <span className="text-brand-500">*</span>
                </label>
                <input
                  id="f-company"
                  className={fieldCls}
                  value={form.company}
                  onChange={(e) => set("company", e.target.value)}
                  placeholder="Nome da sua loja"
                  required
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-phone">
                  WhatsApp <span className="text-brand-500">*</span>
                </label>
                <input
                  id="f-phone"
                  className={fieldCls}
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="(11) 99999-9999"
                  inputMode="tel"
                  required
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-email">
                  E-mail
                </label>
                <input
                  id="f-email"
                  type="email"
                  className={fieldCls}
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="voce@sualoja.com"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-city">
                  Cidade
                </label>
                <input
                  id="f-city"
                  className={fieldCls}
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                  placeholder="Cidade"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-state">
                  Estado
                </label>
                <select
                  id="f-state"
                  className={fieldCls}
                  value={form.state}
                  onChange={(e) => set("state", e.target.value)}
                >
                  <option value="">UF</option>
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="f-insta">
                  Instagram da loja
                </label>
                <input
                  id="f-insta"
                  className={fieldCls}
                  value={form.instagram}
                  onChange={(e) => set("instagram", e.target.value)}
                  placeholder="@sualoja"
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="f-sellers">
                  Quantidade de vendedores
                </label>
                <select
                  id="f-sellers"
                  className={fieldCls}
                  value={form.sellers}
                  onChange={(e) => set("sellers", e.target.value)}
                >
                  <option value="">Selecione</option>
                  {SELLERS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className={labelCls}>Possui loja física?</span>
                <YesNo
                  name="Possui loja física?"
                  value={form.hasPhysical}
                  onChange={(v) => set("hasPhysical", v)}
                />
              </div>
              <div>
                <span className={labelCls}>Possui e-commerce?</span>
                <YesNo
                  name="Possui e-commerce?"
                  value={form.hasEcommerce}
                  onChange={(v) => set("hasEcommerce", v)}
                />
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="f-system">
                Qual sistema utiliza atualmente?
              </label>
              <input
                id="f-system"
                className={fieldCls}
                value={form.currentSystem}
                onChange={(e) => set("currentSystem", e.target.value)}
                placeholder="Planilha, outro CRM, ERP, nenhum…"
              />
            </div>

            <div>
              <label className={labelCls} htmlFor="f-msg">
                Mensagem
              </label>
              <textarea
                id="f-msg"
                rows={3}
                className={`${fieldCls} resize-none`}
                value={form.message}
                onChange={(e) => set("message", e.target.value)}
                placeholder="Conte um pouco sobre sua operação e o que procura."
              />
            </div>

            <label className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.consent}
                onChange={(e) => set("consent", e.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500/30"
                required
              />
              <span className="text-[12.5px] leading-relaxed text-slate-500">
                Autorizo o contato do time AtacadoPro e o tratamento dos meus dados
                para agendar a demonstração, conforme a{" "}
                <span className="text-slate-700 font-medium">LGPD</span>. Seus dados
                não são compartilhados com terceiros.
              </span>
            </label>

            {status === "error" && (
              <p className="text-sm text-rose-600">
                Não foi possível enviar agora. Tente novamente em instantes.
              </p>
            )}

            <button
              type="submit"
              disabled={!valid || status === "sending"}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50 disabled:pointer-events-none"
            >
              {status === "sending" ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  Enviando…
                </>
              ) : (
                "Solicitar demonstração"
              )}
            </button>

            <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-slate-400">
              <IconShield className="size-3.5" />
              Sem compromisso · resposta em até 1 dia útil
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
