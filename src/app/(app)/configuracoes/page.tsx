import { redirect } from "next/navigation";
import {
  MessageCircle,
  Package,
  Store,
  AtSign,
  Megaphone,
  CreditCard,
  Mail,
  ShieldCheck,
  Building2,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/format";
import { Card, PageHeader, Badge } from "@/components/ui";
import { TemplateManager } from "./template-manager";
import { TagManager } from "./tag-manager";
import { CatalogSettings } from "./catalog-settings";
import { catalogDomain } from "@/lib/catalog-url";
import { IntakeSettings } from "./intake-settings";
import { InstallAppCard } from "./install-app";
import { SaleNotifications } from "./sale-notifications";
import { NuvemshopConnect } from "./nuvemshop-connect";
import { JueriConnect } from "./jueri-connect";
import { isAdmin } from "@/lib/scope";
import type { Origin } from "@prisma/client";

export const dynamic = "force-dynamic";

const INTEGRATIONS = [
  {
    name: "WhatsApp Cloud API",
    desc: "Conecte o número oficial da loja para enviar e receber mensagens reais.",
    icon: MessageCircle,
    color: "#10b981",
  },
  { name: "Bling", desc: "Sincronize pedidos, estoque e notas fiscais.", icon: Package, color: "#0ea5e9" },
  { name: "Shopify", desc: "Conecte sua loja Shopify ao funil de vendas.", icon: Store, color: "#059669" },
  { name: "Instagram", desc: "Receba directs e comentários dentro do CRM.", icon: AtSign, color: "#ec4899" },
  { name: "Meta Ads", desc: "Leads dos anúncios entram direto no funil.", icon: Megaphone, color: "#c4622d" },
  { name: "Gateway de pagamento", desc: "Gere links de pagamento na conversa.", icon: CreditCard, color: "#f59e0b" },
  { name: "E-mail marketing", desc: "Sincronize segmentos com sua ferramenta de e-mail.", icon: Mail, color: "#64748b" },
];

export default async function SettingsPage() {
  const user = await requireUser();
  // perfil Suporte é operacional: telas comerciais ficam fora do papel dele
  if (user.role === "SUPPORT") redirect("/pedidos");
  const [company, templates, tags, sellers, stages, originRules] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    db.messageTemplate.findMany({
      where: { companyId: user.companyId },
      orderBy: { title: "asc" },
    }),
    db.tag.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, color: true },
    }),
    db.user.findMany({
      where: { companyId: user.companyId, active: true, role: { not: "SUPERADMIN" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.stage.findMany({
      where: { pipeline: { companyId: user.companyId } },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    db.originRule.findMany({ where: { companyId: user.companyId } }),
  ]);

  const rulesByOrigin = Object.fromEntries(
    originRules.map((r) => [r.origin, r.stageId])
  ) as Partial<Record<Origin, string | null>>;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Configurações"
        subtitle="Dados da loja, modelos de mensagem e integrações."
      />

      <InstallAppCard />
      <SaleNotifications />
      {isAdmin(user) && <NuvemshopConnect />}
      {isAdmin(user) && <JueriConnect />}

      <Card className="p-5 mb-6">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <Building2 className="size-4 text-brand-600" />
          Sua loja
        </h2>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Nome</p>
            <p className="font-medium">{company?.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Plano</p>
            <p className="font-medium capitalize">{company?.plan}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Seu papel</p>
            <p className="font-medium">{roleLabel[user.role]}</p>
          </div>
        </div>
        <div className="flex items-start gap-2 mt-4 pt-4 border-t border-gray-50 text-xs text-gray-500">
          <ShieldCheck className="size-4 text-emerald-600 shrink-0" />
          <p>
            Ambiente multi-empresa: todos os dados (clientes, conversas, vendas
            e relatórios) são isolados por loja. Nenhuma outra empresa acessa
            suas informações.
          </p>
        </div>
      </Card>

      {company && (
        <>
          <h2 className="font-semibold mb-3">Catálogo geral</h2>
          <div className="mb-6">
            <CatalogSettings
              slug={company.slug}
              catalogDomain={catalogDomain()}
              canEdit={isAdmin(user)}
              initial={{
                name: company.name,
                tagline: company.tagline ?? "",
                whatsapp: company.whatsapp ?? "",
                minOrder: company.minOrder,
                minOrderMode: company.minOrderMode as "NONE" | "PECAS" | "VALOR",
                minOrderValue: company.minOrderValue,
                catalogHideOutOfStock: company.catalogHideOutOfStock,
              }}
            />
          </div>
        </>
      )}

      {company && (
        <>
          <h2 className="font-semibold mb-3">Entrada de leads (omnichannel)</h2>
          <div className="mb-6">
            <IntakeSettings
              canEdit={isAdmin(user)}
              sellers={sellers}
              stages={stages}
              initial={{
                distribution: company.intakeDistribution,
                defaultUserId: company.intakeDefaultUserId,
                slaMinutes: company.intakeSlaMinutes,
                oppPolicy: company.intakeOppPolicy,
                rules: rulesByOrigin,
              }}
            />
          </div>
        </>
      )}

      <a
        href="/configuracoes/catalogo"
        className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 mb-3 hover:bg-brand-100 transition"
      >
        <Store className="size-5 text-brand-600 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-brand-800">
            Personalizar catálogo — identidade visual da sua marca
          </p>
          <p className="text-xs text-brand-700/70">
            Logo, paleta de cores, tipografia, suas cores e seus tamanhos.
          </p>
        </div>
      </a>

      {isAdmin(user) && (
        <a
          href="/configuracoes/comunicacao"
          className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 mb-6 hover:bg-brand-100 transition"
        >
          <MessageCircle className="size-5 text-brand-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-brand-800">
              Comunicação — credenciais dos canais
            </p>
            <p className="text-xs text-brand-700/70">
              Meta / WhatsApp Cloud API, Instagram, Facebook, Telegram e SMTP.
              Criptografado e auditado.
            </p>
          </div>
        </a>
      )}

      <h2 className="font-semibold mb-1">Respostas rápidas (modelos de mensagem)</h2>
      <p className="text-sm text-gray-500 mb-3">
        Mensagens prontas que aparecem no atendimento do WhatsApp (pelo atalho “/” ou pelo
        botão ⚡). Use <code className="text-xs">{"{{nome}}"}</code> e{" "}
        <code className="text-xs">{"{{vendedora}}"}</code> para personalizar.
      </p>
      <TemplateManager
        initial={templates.map((t) => ({
          id: t.id,
          title: t.title,
          body: t.body,
          category: t.category,
        }))}
      />

      <h2 className="font-semibold mt-8 mb-1">Etiquetas dos contatos</h2>
      <p className="text-sm text-gray-500 mb-3">
        Marcadores coloridos para organizar os clientes no atendimento (VIP, Atacado,
        Inadimplente…). Também dá para criar uma etiqueta na hora, dentro da conversa.
      </p>
      <TagManager initial={tags} />

      <h2 className="font-semibold mt-8 mb-3">Integrações</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {INTEGRATIONS.map((i) => {
          const Icon = i.icon;
          return (
            <Card key={i.name} className="p-4">
              <div
                className="size-9 rounded-xl flex items-center justify-center mb-3"
                style={{ backgroundColor: `${i.color}1a` }}
              >
                <Icon className="size-4.5" style={{ color: i.color }} />
              </div>
              <p className="text-sm font-semibold mb-1 flex items-center gap-2">
                {i.name}
              </p>
              <p className="text-xs text-gray-500 leading-relaxed mb-3">
                {i.desc}
              </p>
              <Badge color="#94a3b8">Em breve</Badge>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-3">
        A arquitetura já está preparada: o envio de WhatsApp usa uma camada de
        integração (<code className="bg-gray-100 rounded px-1">src/lib/whatsapp.ts</code>)
        que hoje roda em modo simulado e aceita a API oficial sem mudar nenhuma
        tela. Da mesma forma, Bling, Nuvemshop e Shopify já têm contratos de
        sincronização de catálogo, estoque e pedidos definidos em{" "}
        <code className="bg-gray-100 rounded px-1">src/lib/integrations/catalog.ts</code>.
      </p>
    </div>
  );
}
