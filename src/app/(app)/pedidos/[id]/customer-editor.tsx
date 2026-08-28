"use client";

/**
 * Dados do cliente + venda na tela do pedido, com edição inline.
 *
 * Pedidos do catálogo público podem chegar sem identificação; o vendedor
 * preenche aqui nome, telefone, CPF, CNPJ, e-mail e endereço (nada é
 * obrigatório além do nome), além do vendedor responsável e do canal de
 * origem do cliente.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { formatPhone, originLabel } from "@/lib/format";
import { documentoParaMostrar } from "@/lib/documento";
import { Avatar } from "@/components/ui";

type CustomerData = {
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
  stateRegistration: string | null;
  legalName: string | null;
  zip: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  origin: string;
};

export function CustomerEditor({
  customerId,
  orderId,
  customer,
  sellerId,
  sellers,
  vendaOnline = false,
  sellerName = null,
}: {
  customerId: string;
  orderId: string;
  customer: CustomerData;
  sellerId: string | null;
  sellers: { id: string; name: string }[];
  /** venda da Nuvemshop: sem vendedora por regra (RN-005) — o campo some */
  vendaOnline?: boolean;
  /** nome da vendedora atual (para o caso legado: atribuída antes da regra) */
  sellerName?: string | null;
}) {
  const router = useRouter();
  const unidentified =
    !customer.phone || customer.name.startsWith("Cliente do catálogo");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: customer.name.startsWith("Cliente do catálogo") ? "" : customer.name,
    phone: customer.phone,
    email: customer.email ?? "",
    cpf: customer.cpf ?? "",
    cnpj: customer.cnpj ?? "",
    stateRegistration: customer.stateRegistration ?? "",
    legalName: customer.legalName ?? "",
    zip: customer.zip ?? "",
    street: customer.street ?? "",
    streetNumber: customer.streetNumber ?? "",
    complement: customer.complement ?? "",
    district: customer.district ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    origin: customer.origin,
    sellerId: sellerId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; phone: string; city: string | null; state: string | null }[]
  >([]);

  // caso legado da venda online: tira a vendedora atribuída antes da regra
  // (o servidor exige gerência e registra no histórico do pedido)
  async function removerVendedora() {
    setSaving(true);
    setError("");
    const r = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellerId: null }),
    }).catch(() => null);
    setSaving(false);
    if (!r || !r.ok) {
      const data = await r?.json().catch(() => null);
      return setError(data?.error ?? "Não foi possível remover.");
    }
    setOpen(false);
    router.refresh();
  }

  // CEP → ENDEREÇO SOZINHO (pedido do dono, 17/08/2026): digitou o CEP,
  // rua/bairro/cidade/UF chegam preenchidos (busca pública dos Correios via
  // ViaCEP, direto do navegador). Cidade/UF sempre acompanham o CEP (derivam
  // dele — é o que conserta endereço com cidade errada); rua e bairro só
  // preenchem campo VAZIO, nunca pisam no que a vendedora digitou.
  const cepBuscado = useRef("");
  useEffect(() => {
    if (!open) return;
    const cep = form.zip.replace(/\D/g, "");
    if (cep.length !== 8 || cep === cepBuscado.current) return;
    const t = setTimeout(async () => {
      cepBuscado.current = cep;
      try {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const d = (await r.json()) as {
          erro?: boolean;
          logradouro?: string;
          bairro?: string;
          localidade?: string;
          uf?: string;
        };
        if (!r.ok || d?.erro) return;
        setForm((f) =>
          // resposta ATRASADA de um CEP antigo não pisa no CEP novo: só
          // preenche se o campo ainda mostra o CEP desta busca
          f.zip.replace(/\D/g, "") === cep
            ? {
                ...f,
                street: f.street.trim() ? f.street : d.logradouro ?? "",
                district: f.district.trim() ? f.district : d.bairro ?? "",
                city: d.localidade || f.city,
                state: d.uf || f.state,
              }
            : f
        );
      } catch {
        // ViaCEP fora do ar ou sem internet: segue digitando na mão
      }
    }, 400);
    return () => clearTimeout(t);
  }, [form.zip, open]);

  // Busca de clientes já cadastrados (para vincular sem redigitar)
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(query.trim())}`);
      if (res.ok) setResults(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [query, open]);

  async function linkCustomer(id: string) {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: id }),
    });
    setSaving(false);
    if (!res.ok) return setError("Não foi possível vincular o cliente.");
    setOpen(false);
    setQuery("");
    setResults([]);
    router.refresh();
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.name.trim()) return setError("Informe o nome.");
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (form.phone && phoneDigits.length < 8)
      return setError("Telefone incompleto (use DDD + número).");
    setSaving(true);
    setError("");

    const customerBody: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      cpf: form.cpf.trim() || null,
      cnpj: form.cnpj.trim() || null,
      // IE sem CNPJ não existe: apagou o CNPJ, a IE vai junto
      stateRegistration: form.cnpj.trim() ? form.stateRegistration.trim() || null : null,
      legalName: form.cnpj.trim() ? form.legalName.trim() || null : null,
      // waName NÃO viaja daqui: não há campo na tela, e mandar o valor da
      // abertura da página pisaria no nome que o webhook gravou depois
      zip: form.zip.trim() || null,
      street: form.street.trim() || null,
      streetNumber: form.streetNumber.trim() || null,
      complement: form.complement.trim() || null,
      district: form.district.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      origin: form.origin,
    };
    if (phoneDigits.length >= 8) customerBody.phone = form.phone.trim();

    const res = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerBody),
    });
    let ok = res.ok;
    // o erro tem que vir da CHAMADA QUE FALHOU: antes, quando o cliente
    // salvava e a troca de vendedor era recusada, a tela lia a resposta boa
    // e mostrava um "não foi possível salvar" genérico — escondendo o motivo
    // real (permissão) e o fato de os dados do cliente JÁ terem sido salvos
    let respostaComErro: Response | null = res.ok ? null : res;
    if (ok && !vendaOnline && (form.sellerId || null) !== (sellerId ?? null)) {
      const r2 = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerId: form.sellerId || null }),
      });
      ok = r2.ok;
      if (!r2.ok) respostaComErro = r2;
    }
    setSaving(false);
    if (!ok) {
      const data = await respostaComErro?.json().catch(() => null);
      return setError(data?.error ?? "Não foi possível salvar.");
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    const doc = documentoParaMostrar(customer);
    const addr = [
      [
        [customer.street, customer.streetNumber].filter(Boolean).join(", "),
        customer.complement,
      ].filter(Boolean).join(" - "),
      customer.district,
      [customer.city, customer.state].filter(Boolean).join("/"),
      customer.zip ? `CEP ${customer.zip}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <div className="mt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Avatar name={customer.name} color="#c4622d" size="sm" />
          <Link
            href={`/clientes/${customerId}`}
            className="text-sm font-medium hover:text-brand-600"
          >
            {customer.name}
          </Link>
          {customer.phone ? (
            <span className="text-xs text-gray-400">
              {formatPhone(customer.phone)}
            </span>
          ) : (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-0.5">
              sem dados de contato
            </span>
          )}
          <span className="text-xs text-gray-400">
            · Canal: {originLabel[customer.origin as keyof typeof originLabel] ?? customer.origin}
          </span>
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 transition"
          >
            <Pencil className="size-3" />
            {unidentified ? "Preencher dados do cliente" : "Editar dados"}
          </button>
        </div>
        {(doc || customer.email || addr) && (
          <div className="mt-1.5 space-y-0.5 text-xs text-gray-400">
            {doc && <p>{doc}</p>}
            {customer.email && <p>E-mail: {customer.email}</p>}
            {addr && <p>Endereço: {addr}</p>}
          </div>
        )}
      </div>
    );
  }

  const input =
    "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-300";
  const label = "block text-[11px] font-semibold text-gray-500 mb-1";

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4 max-w-2xl">
      <p className="text-xs font-semibold text-gray-600 mb-2">
        Vincular um cliente já cadastrado
      </p>
      <div className="relative mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nome, telefone ou CPF/CNPJ…"
          className={input}
        />
        {results.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-pop max-h-56 overflow-y-auto">
            {results.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => linkCustomer(c.id)}
                className="w-full text-left px-3 py-2 hover:bg-brand-50 transition"
              >
                <span className="block text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-gray-400">
                  {[formatPhone(c.phone), [c.city, c.state].filter(Boolean).join("/")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-600 mb-3">
        Ou preencha os dados manualmente
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <span className={label}>Nome *</span>
          <input value={form.name} onChange={set("name")} placeholder="Nome do cliente" className={input} />
        </div>
        <div>
          <span className={label}>Telefone (com DDD)</span>
          <input value={form.phone} onChange={set("phone")} placeholder="(11) 99999-0000" inputMode="tel" className={input} />
        </div>
        {/* CPF e CNPJ separados: a cliente lojista tem os dois e cada
            transportadora pede um deles */}
        <div>
          <span className={label}>CPF</span>
          <input value={form.cpf} onChange={set("cpf")} placeholder="000.000.000-00" inputMode="numeric" className={input} />
        </div>
        <div>
          <span className={label}>CNPJ</span>
          <input value={form.cnpj} onChange={set("cnpj")} placeholder="00.000.000/0000-00" inputMode="numeric" className={input} />
        </div>
        {/* IE só aparece quando há CNPJ: acompanha a pessoa jurídica (algumas
            transportadoras exigem na etiqueta) */}
        {form.cnpj.trim() && (
          <>
            <div>
              <span className={label}>Inscrição Estadual</span>
              <input value={form.stateRegistration} onChange={set("stateRegistration")} placeholder="000.000.000.000 (ou vazio se isenta)" inputMode="numeric" className={input} />
            </div>
            <div>
              {/* RN-024: a FICHA fica no nome de quem conversa; a razão social
                  sai na NF-e, na etiqueta e na declaração de conteúdo */}
              <span className={label}>Razão social (sai na nota e na etiqueta)</span>
              <input value={form.legalName} onChange={set("legalName")} placeholder="Nome da empresa como está no CNPJ" className={input} />
            </div>
          </>
        )}
        <div>
          <span className={label}>E-mail</span>
          <input value={form.email} onChange={set("email")} placeholder="cliente@email.com" type="email" className={input} />
        </div>
        <div>
          <span className={label}>CEP</span>
          <input value={form.zip} onChange={set("zip")} placeholder="00000-000" inputMode="numeric" className={input} />
        </div>
        <div>
          <span className={label}>Rua</span>
          <input value={form.street} onChange={set("street")} placeholder="Rua / Avenida" className={input} />
        </div>
        <div>
          <span className={label}>Número</span>
          <input value={form.streetNumber} onChange={set("streetNumber")} placeholder="123" className={input} />
        </div>
        <div>
          <span className={label}>Complemento</span>
          <input value={form.complement} onChange={set("complement")} placeholder="Apto, bloco, loja, sala…" className={input} />
        </div>
        <div>
          <span className={label}>Bairro</span>
          <input value={form.district} onChange={set("district")} placeholder="Bairro" className={input} />
        </div>
        <div>
          <span className={label}>Cidade</span>
          <input value={form.city} onChange={set("city")} placeholder="Cidade" className={input} />
        </div>
        <div>
          <span className={label}>Estado (UF)</span>
          <input value={form.state} onChange={set("state")} placeholder="SP" maxLength={2} className={input} />
        </div>
        {vendaOnline ? (
          <div>
            <span className={label}>Vendedor(a) da venda</span>
            {sellerId ? (
              // caso LEGADO: vendedora atribuída antes da regra de 28/08/2026
              // — está gerando comissão indevida; a gerência pode REMOVER
              // (atribuir/trocar segue proibido)
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <p>
                  Atribuída a <b>{sellerName ?? "uma vendedora"}</b> antes da
                  regra atual — venda da loja online não gera comissão.
                </p>
                <button
                  type="button"
                  disabled={saving}
                  onClick={removerVendedora}
                  className="mt-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:border-amber-400 disabled:opacity-60"
                >
                  Remover vendedora (gerência)
                </button>
              </div>
            ) : (
              <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-500">
                Venda da loja online (Nuvemshop) — fica sem vendedora e não gera
                comissão.
              </p>
            )}
          </div>
        ) : (
          <div>
            <span className={label}>Vendedor(a) da venda</span>
            <select value={form.sellerId} onChange={set("sellerId")} className={input}>
              <option value="">Sem vendedor definido</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <span className={label}>Canal de origem do cliente</span>
          <select value={form.origin} onChange={set("origin")} className={input}>
            {Object.entries(originLabel).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-3.5 py-2 transition disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-200 text-gray-500 text-xs font-medium px-3.5 py-2 transition hover:bg-white"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
