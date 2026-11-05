import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

import { VersionWatcher } from "@/components/version-watcher";

// Inter = brand font (assetin design kit, D-070); the --font-sans variable
// links it to the @theme mapping in globals.css.
const interSans = Inter({
  variable: "--font-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AIM Viewer",
  description: "Asset Information Model — viewer správne previazaných dát",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${interSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <VersionWatcher />
      </body>
    </html>
  );
}
