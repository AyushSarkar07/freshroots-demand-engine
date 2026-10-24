import { type NextRequest, NextResponse } from "next/server";
import { askRulebook, rulebookMarkdown } from "@/lib/rulebook";
import { loadRun } from "@/lib/runs";
import { DEFAULT_CONFIG } from "@/lib/engine/config";

// GET: the rulebook as Markdown, generated from the thresholds the run actually used.
export async function GET(req: NextRequest) {
  const run = await loadRun(req.nextUrl.searchParams.get("run"));
  const md = rulebookMarkdown(run?.result.config ?? DEFAULT_CONFIG, run ? `the run evaluated ${run.evaluation_date}` : "the default configuration");
  return new Response(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'attachment; filename="freshroots_rulebook.md"', "cache-control": "no-store" } });
}

// POST: ask why a rule exists. Answers come only from the rulebook, with section citations.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { question?: string; run?: string };
  const question = String(body.question ?? "").trim();
  if (question.length < 4) return NextResponse.json({ error: "Ask a question about the rules." }, { status: 400 });
  if (question.length > 400) return NextResponse.json({ error: "Keep the question under 400 characters." }, { status: 400 });
  const run = await loadRun(body.run ?? null);
  return NextResponse.json(await askRulebook(run?.result.config ?? DEFAULT_CONFIG, question));
}
