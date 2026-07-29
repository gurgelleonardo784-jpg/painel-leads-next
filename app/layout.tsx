import type { Metadata } from "next";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { SCRIPT_TEMA } from "@/components/TemaBotao";

/* Instrument Sans na interface; IBM Plex Mono em número, telefone, UTM e valor
   — tudo que precisa alinhar em coluna ou ser lido dígito a dígito. */
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--fonte-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--fonte-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Painel de Leads",
  description: "Painel de leads por cliente, com WhatsApp, status e anotações.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // o script abaixo mexe no <html> antes da hidratação; é intencional
    <html lang="pt-BR" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* aplica o tema salvo antes da primeira pintura, para não piscar branco */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
