import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";
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
        <AppHeader />
        <div className="flex-1 flex flex-col">{children}</div>
        <AppFooter />
      </body>
    </html>
  );
}
