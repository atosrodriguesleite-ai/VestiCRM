import type { Metadata, Viewport } from "next";
import { Archivo, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";
import { KeyboardInset } from "@/components/keyboard-inset";
import { ID_FIM_DA_PAGINA, SCRIPT_DO_VIGIA } from "@/lib/vigia-da-abertura";

// Tipografia do manual da marca: Archivo é a voz (títulos e corpo);
// Spline Sans Mono entra apenas em rótulos, dados e legendas.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});
const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "AtacadoPro — O jeito profissional de vender no atacado",
  description:
    "AtacadoPro transforma o WhatsApp em uma máquina de receber pedidos organizados: catálogo profissional, pedidos, funil e gestão inteligente.",
  applicationName: "AtacadoPro",
  // PWA: iOS abre em tela cheia quando adicionado à tela de início
  appleWebApp: {
    capable: true,
    title: "AtacadoPro",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16100B",
  // teclado do celular ENCOLHE a área da página (em vez de cobri-la),
  // para que botões no rodapé de janelas/formulários não fiquem escondidos
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${archivo.variable} ${splineMono.variable} font-sans antialiased`}>
        {/* RN-095 · o vigia da abertura é o PRIMEIRO filho do body: chega
            junto com o <head>, antes de qualquer tela, e sem depender de
            nada — é ele que troca a tela branca de uma página que chegou
            cortada pelo aviso com o botão (`lib/vigia-da-abertura.ts`) */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_DO_VIGIA }} />
        <KeyboardInset />
        {children}
        {/* …e o marcador é o ÚLTIMO: quando ele existe, o esqueleto da
            página chegou inteiro */}
        <span id={ID_FIM_DA_PAGINA} hidden />
      </body>
    </html>
  );
}
