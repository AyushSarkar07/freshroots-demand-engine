import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const sans = Inter({ variable: "--font-sans-face", subsets: ["latin"] });
const serif = Fraunces({ variable: "--font-serif-face", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Freshroots Reorder Desk",
  description: "Twice-weekly reorder decisions from the SAP export: rules decide, people approve.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Nav />
        <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
