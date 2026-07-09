import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

const SITE_URL = "https://www.atacadopro.com.br";
const TITLE = "AtacadoPro — O jeito profissional de vender no atacado";
const DESCRIPTION =
  "AtacadoPro transforma o WhatsApp em uma máquina de receber pedidos organizados: catálogo profissional, pedidos, funil de vendas e gestão inteligente para atacadistas. Solicite uma demonstração gratuita.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "plataforma para atacadistas",
    "vender no atacado pelo WhatsApp",
    "catálogo de atacado",
    "pedidos no atacado",
    "funil de vendas",
    "sistema para atacado",
    "gestão de vendas atacado",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    siteName: "AtacadoPro",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/shots/dashboard.png",
        width: 1600,
        height: 1000,
        alt: "Painel do AtacadoPro — o jeito profissional de vender no atacado",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/shots/dashboard.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "AtacadoPro",
      url: SITE_URL,
      slogan: "O jeito profissional de vender no atacado.",
      description: DESCRIPTION,
    },
    {
      "@type": "SoftwareApplication",
      name: "AtacadoPro",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description: DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "BRL",
        description:
          "Demonstração gratuita com atendimento humano e implantação personalizada.",
      },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Preciso pagar para testar o AtacadoPro?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Não. O primeiro passo é sempre uma demonstração gratuita e sem compromisso, com um especialista mostrando a plataforma ao vivo.",
          },
        },
        {
          "@type": "Question",
          name: "Como funciona a contratação?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Não há compra automática nem cadastro self-service. Depois da demonstração, montamos uma proposta e uma implantação personalizada para a sua loja.",
          },
        },
        {
          "@type": "Question",
          name: "O catálogo fica com a cara da minha loja?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Sim. Você personaliza logo, cores, tipografia e organização. A sua cliente vê a identidade da sua marca.",
          },
        },
      ],
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Landing />
    </>
  );
}
