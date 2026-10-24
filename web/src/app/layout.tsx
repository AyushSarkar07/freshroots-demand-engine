import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import { Sidebar, type RunContext } from "@/components/Sidebar";
import { ToastProvider } from "@/components/toast";
import { getConfig } from "@/lib/config";
import { ENGINE_VERSION } from "@/lib/engine/engine";
import { ensureSeeded } from "@/lib/runs";
import { getStore } from "@/lib/store";
import "./globals.css";

const sans = Inter({ variable: "--font-sans-face", subsets: ["latin"] });
const display = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Freshroots Reorder Desk",
  description: "Demand moves. Stay ahead. Twice-weekly reorder decisions from the SAP export: rules decide, people approve.",
};
export const viewport: Viewport = { themeColor: "#1b1120" };
// The sidebar shows the live run list, so no page (not even the 404) is frozen at build time.
export const dynamic = "force-dynamic";

async function runContexts(): Promise<RunContext[]> {
  try {
    await ensureSeeded();
    return (await getStore().listRuns()).map((r) => ({ id: r.id, source: r.source, evaluation_date: r.evaluation_date, sales_cutoff_week: r.sales_cutoff_week, label: r.label }));
  } catch {
    return []; // the page itself reports the failure; navigation must still render
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const runs = await runContexts();
  const cfg = getConfig();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full`}>
      <body className="min-h-full">
        <ToastProvider>
          <div className="min-h-screen lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
            <Sidebar runs={runs} />
            <div className="flex min-w-0 flex-col">
              <main className="flex-1">{children}</main>
              <footer className="border-t border-line px-5 py-5 text-[12px] text-muted sm:px-8 lg:px-10">
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <span>Engine v{ENGINE_VERSION} · rules-based, deterministic</span>
                  <span>Storage: {cfg.db === "postgres" ? "Postgres" : "in memory"}</span>
                  <span>Brief: {cfg.ai === "gemini" ? `Gemini (${cfg.geminiModel}), number-checked` : "template"}</span>
                  <span>Alerts: {[cfg.telegram === "live" && "Telegram", cfg.slack === "live" && "Slack"].filter(Boolean).join(" + ") || "simulated"}</span>
                  <span className="sm:ml-auto">No order leaves this app without a named approver.</span>
                </div>
              </footer>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}
