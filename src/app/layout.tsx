import type { Metadata, Viewport } from "next";
import { Archivo, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16100B",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${archivo.variable} ${splineMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
