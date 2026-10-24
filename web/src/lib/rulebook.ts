import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "./config";
import { CONFLICT_LABEL, type ConflictCode } from "./conflicts";
import type { EngineConfig } from "./engine/config";
import { ADOPTION, CONFLICT_POLICY, CONSTANTS, PEOPLE, PLAYBOOK, ruleDocs, VARIABLES } from "./governance";
import { SHADOW } from "./shadow";

export interface Section { id: string; title: string; body: string }

/** The rulebook as sections: the unit for both the Markdown download and question answering. */
export function rulebookSections(c: EngineConfig): Section[] {
  const who = (k: keyof typeof PEOPLE) => `${PEOPLE[k].name} (${PEOPLE[k].role})`;
  const rules = ruleDocs(c).map((r) => ({
    id: r.id, title: `${r.id} · ${r.title}`,
    body: `Rule: ${r.rule}\nWhy it exists: ${r.why}\nEdge cases:\n${r.edges.map((e) => `- ${e}`).join("\n")}\nOwner: ${who(r.owner)}. Type: ${r.kind}. Source: ${r.source}.`,
  }));
  const conflicts = (Object.keys(CONFLICT_POLICY) as ConflictCode[]).map((k, i) => ({
    id: `C${i + 1}`, title: `C${i + 1} · Conflict: ${CONFLICT_LABEL[k]}`,
    body: `Which rule wins: ${CONFLICT_POLICY[k].winner}\nMonthly review question: ${CONFLICT_POLICY[k].review}\nOwner: ${who(CONFLICT_POLICY[k].owner)}.`,
  }));
  const playbook = PLAYBOOK.map((p, i) => ({
    id: `F${i + 1}`, title: `F${i + 1} · Failure: ${p.scenario}`,
    body: `How it shows up: ${p.signal}\nWhat the system does: ${p.automatic}\nOverride: ${p.override}\nOwner: ${who(p.owner)}.`,
  }));
  return [
    ...rules, ...conflicts, ...playbook,
    { id: "K1", title: "K1 · Kill criterion (shadow mode)", body: `For the first four weeks the planner records his own call for every SKU before seeing the engine's (Oversight → Record planner calls). The engine's answer is revealed only after his call is saved.\nIf the engine agrees with the planner on fewer than ${Math.round(SHADOW.killThreshold * 100)}% of the SKUs the rules cover (at least ${SHADOW.minSample} calls), the written rules aren't how he actually plans: stop and redesign before going live.\nReorder quantities count as the same within ±${Math.round(SHADOW.qtyTolerance * 100)}%. SKUs held for planner review aren't counted. Every disagreement needs a reason, and those reasons drive the monthly rule review.\nOwner: ${who("raghav")}; reviewed with ${who("deepa")}.` },
    { id: "V1", title: "V1 · Variables and constants", body: `Variables (expected to change; review them):\n${VARIABLES.map((v) => `- ${v}`).join("\n")}\nConstants (hold by design):\n${CONSTANTS.map((v) => `- ${v}`).join("\n")}` },
    { id: "A1", title: "A1 · Ownership and adoption", body: `Champion: ${who(ADOPTION.champion.person)}. ${ADOPTION.champion.why}\nSponsor: ${who(ADOPTION.sponsor.person)}. ${ADOPTION.sponsor.why}\nAccountability:\n${ADOPTION.accountability.map((a) => `- ${who(a.who)}: ${a.for}`).join("\n")}\nIncentives:\n${ADOPTION.incentives.map((a) => `- ${a}`).join("\n")}\nPeople:\n${ADOPTION.people.map((a) => `- ${a}`).join("\n")}` },
  ];
}

export function rulebookMarkdown(c: EngineConfig, generatedFor: string): string {
  const s = rulebookSections(c);
  return [
    "# Freshroots Reorder Desk · Rulebook",
    "",
    `Why every rule exists, who owns it, where rules conflict, and what to do when the world stops matching the model. Generated from the engine configuration used by ${generatedFor}.`,
    "",
    ...s.flatMap((x) => [`## ${x.title}`, "", x.body, ""]),
  ].join("\n");
}

/** Plain keyword retrieval: used without Gemini, and to pick the sections Gemini sees. */
export function searchRulebook(sections: Section[], question: string, k = 3): Section[] {
  const words = question.toLowerCase().match(/[a-z0-9%]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
  const scored = sections.map((s) => {
    const text = `${s.title} ${s.body}`.toLowerCase();
    return { s, score: words.reduce((n, w) => n + (text.includes(w) ? (s.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0) };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((x) => x.s);
}
const STOP = new Set(["the", "and", "why", "what", "does", "this", "that", "for", "are", "how", "who", "when", "with", "rule", "rules", "exist", "exists", "there", "about", "our", "can", "should"]);

let client: GoogleGenAI | null = null;

export async function askRulebook(c: EngineConfig, question: string): Promise<{ answer: string; cites: string[]; source: "gemini" | "search"; note?: string }> {
  const sections = rulebookSections(c);
  const hits = searchRulebook(sections, question, 4);
  const fallback = () => hits.length
    ? { answer: hits.map((h) => `${h.title}\n${h.body}`).join("\n\n"), cites: hits.map((h) => h.id), source: "search" as const }
    : { answer: "The rulebook doesn't cover that. Ask the rule owner (Raghav Kulkarni) and add the answer to the rulebook.", cites: [], source: "search" as const };
  if (getConfig().ai !== "gemini") return fallback();
  try {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const res = await Promise.race([
      client.interactions.create({
        model: getConfig().geminiModel,
        system_instruction: "You answer questions about Freshroots' reorder rules using ONLY the rulebook sections provided. Cite section ids in square brackets, e.g. [R2]. If the sections don't answer the question, say exactly: \"The rulebook doesn't cover that.\" Plain English, at most 90 words, no markdown.",
        input: `Rulebook:\n${sections.map((s) => `[${s.id}] ${s.title}\n${s.body}`).join("\n\n")}\n\nQuestion: ${question}`,
        generation_config: { thinking_level: "low" },
        store: false,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 20_000)),
    ]);
    const answer = (res.output_text ?? "").trim();
    if (!answer) return { ...fallback(), note: "Gemini returned nothing; showing matching sections." };
    const cites = [...new Set(answer.match(/\[([A-Z]\d+)\]/g)?.map((m) => m.slice(1, -1)) ?? [])].filter((id) => sections.some((s) => s.id === id));
    return { answer, cites, source: "gemini" };
  } catch (e) {
    return { ...fallback(), note: `Gemini unavailable (${(e as Error).message}); showing matching sections.` };
  }
}
