import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
import { MartineWidget } from "@/components/martine/MartineWidget";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FlowDataGouv - Explorez les donnees ouvertes francaises",
  description:
    "Chatbot IA pour explorer, comprendre et analyser les datasets de data.gouv.fr. Acces gratuit et anonyme.",
  keywords: [
    "data.gouv.fr",
    "open data",
    "donnees ouvertes",
    "France",
    "chatbot",
    "IA",
    "datasets",
  ],
  openGraph: {
    title: "FlowDataGouv",
    description: "Explorez les donnees ouvertes francaises avec l'IA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-dvh flex flex-col`}
      >
        <div className="bg-red-50 border-b border-red-200 text-center text-xs text-red-700 py-1.5 px-4">
          ❤️ Merci pour votre int&eacute;r&ecirc;t ! Ce projet de R&amp;D sur l&apos;open data fran&ccedil;ais s&apos;ach&egrave;ve fin mars 2026. Explorez le{" "}
          <a href="https://github.com/FLI-GCT/FlowDataGouv" className="underline font-medium" target="_blank" rel="noopener noreferrer">code source</a>
          {" "}ou utilisez le{" "}
          <a href="https://github.com/datagouv/mcp-data.gouv.fr" className="underline font-medium" target="_blank" rel="noopener noreferrer">MCP officiel de data.gouv.fr</a>
          {" "}pour continuer l&apos;aventure.
        </div>
        <AppHeader />
        <div className="flex-1 flex flex-col">{children}</div>
        <AppFooter />
        <MartineWidget />
      </body>
    </html>
  );
}
