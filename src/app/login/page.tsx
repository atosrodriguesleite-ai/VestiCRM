"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, TrendingUp, BarChart3, ArrowRight } from "lucide-react";
import { Logo, LogoMark } from "@/components/logo";
import { Spinner } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("ana@bellamoda.com.br");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(data.role === "SUPERADMIN" ? "/lojas" : "/dashboard");
      router.refresh();
    } else {
      setError(data.error ?? "E-mail ou senha inválidos");
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 transition";

  return (
    <div className="min-h-dvh flex bg-canvas">
      {/* Painel institucional (desktop) */}
      <div className="hidden lg:flex flex-col justify-between w-[48%] relative overflow-hidden bg-sidebar text-white p-12">
        {/* brilho decorativo */}
        <div className="absolute -top-32 -right-24 size-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute bottom-0 -left-24 size-80 rounded-full bg-brand-500/20 blur-3xl" />

        <div className="relative">
          <Logo onDark size="lg" />
        </div>

        <div className="relative space-y-10 max-w-md">
          <div>
            <h1 className="text-[40px] leading-[1.1] font-semibold tracking-tight">
              A plataforma comercial para lojas de moda.
            </h1>
            <p className="text-slate-400 mt-4 text-lg">
              Do primeiro clique no catálogo à recompra — tudo em um só lugar.
            </p>
          </div>
          <ul className="space-y-3.5">
            {(
              [
                [MessageCircle, "Atendimento no WhatsApp integrado ao funil"],
                [TrendingUp, "Follow-up automático para nunca perder cliente"],
                [BarChart3, "Inteligência comercial de cada venda e canal"],
              ] as const
            ).map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-slate-300">
                <span className="size-9 rounded-xl bg-white/5 ring-1 ring-white/10 flex items-center justify-center shrink-0">
                  <Icon className="size-[18px] text-brand-300" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-slate-500">
          © {new Date().getFullYear()} VestiCRM · A plataforma comercial para
          lojas de moda
        </p>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex justify-center mb-10">
            <div className="flex flex-col items-center gap-3">
              <LogoMark className="size-12" rounded="rounded-2xl" />
              <span className="text-xl font-semibold tracking-tight">
                Vesti<span className="text-brand-600">CRM</span>
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-1">
            Bem-vinda de volta
          </h2>
          <p className="text-sm text-slate-500 mb-8">
            Acesse o painel comercial da sua loja.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
                placeholder="voce@sualoja.com.br"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Senha
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3.5 py-2.5 border border-rose-100">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.99] text-white font-medium py-3 text-sm transition disabled:opacity-60 flex items-center justify-center gap-2 shadow-xs hover:shadow-card"
            >
              {loading ? (
                <>
                  <Spinner /> Entrando...
                </>
              ) : (
                <>
                  Entrar <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-slate-600 mb-1">
              Contas de demonstração · senha demo1234
            </p>
            <p>ana@bellamoda.com.br — Administradora</p>
            <p>carla@bellamoda.com.br — Gerente</p>
            <p>julia@bellamoda.com.br — Vendedora</p>
          </div>
        </div>
      </div>
    </div>
  );
}
