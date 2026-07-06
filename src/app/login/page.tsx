"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, MessageCircle, TrendingUp, Users } from "lucide-react";

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
    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "E-mail ou senha inválidos");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh flex">
      {/* Painel institucional (desktop) */}
      <div className="hidden lg:flex flex-col justify-between w-[46%] bg-gradient-to-br from-brand-700 via-brand-600 to-fuchsia-600 text-white p-12">
        <div className="flex items-center gap-2.5">
          <div className="size-10 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Sparkles className="size-5" />
          </div>
          <span className="text-xl font-semibold tracking-tight">VestiCRM</span>
        </div>
        <div className="space-y-8 max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Transforme conversas de WhatsApp em vendas.
          </h1>
          <ul className="space-y-4 text-white/85">
            <li className="flex items-center gap-3">
              <MessageCircle className="size-5 shrink-0" />
              Central de atendimento integrada ao funil
            </li>
            <li className="flex items-center gap-3">
              <TrendingUp className="size-5 shrink-0" />
              Follow-up automático para nunca perder cliente
            </li>
            <li className="flex items-center gap-3">
              <Users className="size-5 shrink-0" />
              Feito para lojas, atacados, boutiques e revendedoras
            </li>
          </ul>
        </div>
        <p className="text-sm text-white/60">
          © {new Date().getFullYear()} VestiCRM · CRM para moda
        </p>
      </div>

      {/* Formulário */}
      <div className="flex-1 flex items-center justify-center p-6 bg-canvas">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center gap-2.5 mb-10 justify-center">
            <div className="size-10 rounded-xl bg-brand-600 text-white flex items-center justify-center">
              <Sparkles className="size-5" />
            </div>
            <span className="text-xl font-semibold tracking-tight">
              VestiCRM
            </span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mb-1">
            Entrar na sua loja
          </h2>
          <p className="text-sm text-gray-500 mb-8">
            Acesse o painel comercial da sua equipe.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100 transition"
                placeholder="voce@sualoja.com.br"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100 transition"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 active:scale-[0.99] text-white font-medium py-2.5 text-sm transition disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50 p-4 text-xs text-brand-800 space-y-1">
            <p className="font-semibold">Contas de demonstração (senha: demo1234)</p>
            <p>ana@bellamoda.com.br — Administradora</p>
            <p>carla@bellamoda.com.br — Gerente</p>
            <p>julia@bellamoda.com.br — Vendedora</p>
          </div>
        </div>
      </div>
    </div>
  );
}
