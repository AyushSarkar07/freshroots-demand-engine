import { NextResponse, type NextRequest } from "next/server";
import { ConfigurationError } from "@/lib/engine/config";
import { FreshrootsError } from "@/lib/engine/engine";
import { createRun } from "@/lib/runs";
import { applyScenario, ScenarioError, type ScenarioRequest } from "@/lib/scenario";
import { getStore } from "@/lib/store";

// The database simulation exercise: copy a real run's tables, change them, rerun the engine.
// The scenario is stored as its own run, linked to its base, and can never be approved or exported.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ScenarioRequest & { base_run_id?: string; created_by?: string };
  const createdBy = String(body.created_by ?? "").trim();
  if (createdBy.length < 2) return NextResponse.json({ error: "Enter your name so the scenario is attributable." }, { status: 400 });
  const base = body.base_run_id ? await getStore().getRun(body.base_run_id) : null;
  if (!base) return NextResponse.json({ error: "Base run not found." }, { status: 404 });
  if (base.source === "scenario") return NextResponse.json({ error: "Build scenarios from a real run, not from another scenario." }, { status: 400 });

  try {
    const { inputs, spec, overrides } = applyScenario(base.inputs, body);
    const parts = [spec.remove_history && "no sales history", spec.new_distributor && `new distributor ${spec.new_distributor.id}`, spec.remap_to && `remapped to ${spec.remap_to}`, spec.festival_uplift === "off" && "festival uplift off"].filter(Boolean);
    const run = await createRun({
      inputs, evaluationDate: base.evaluation_date, createdBy, source: "scenario", baseRunId: base.id, scenario: spec, overrides,
      label: `Scenario: ${spec.sku_id} with ${parts.join(", ")}`,
    });
    return NextResponse.json({ id: run.id, base_run_id: base.id });
  } catch (e) {
    if (e instanceof ScenarioError || e instanceof FreshrootsError || e instanceof ConfigurationError) {
      return NextResponse.json({ error: e.message, type: e.name }, { status: 422 });
    }
    throw e;
  }
}
