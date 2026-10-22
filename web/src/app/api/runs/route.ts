import { NextResponse, type NextRequest } from "next/server";
import { FreshrootsError, type EngineInputs } from "@/lib/engine/engine";
import { ConfigurationError } from "@/lib/engine/config";
import { createRun, INPUT_FILES } from "@/lib/runs";

const MAX_BYTES = 5 * 1024 * 1024;

// Upload a fresh SAP export: the engine validates it, decides every SKU, and the run is stored.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const createdBy = String(form.get("created_by") ?? "").trim();
  const evaluationDate = String(form.get("evaluation_date") ?? "").trim();
  if (createdBy.length < 2) return NextResponse.json({ error: "Enter your name so the run is attributable." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)) return NextResponse.json({ error: "Evaluation date must be YYYY-MM-DD." }, { status: 400 });

  const inputs: Partial<EngineInputs> = {};
  const fileNames: Partial<Record<keyof EngineInputs, string>> = {};
  for (const f of INPUT_FILES) {
    const file = form.get(f.key);
    if (!(file instanceof File) || file.size === 0) {
      if (f.required) return NextResponse.json({ error: `${f.label} (${f.file}) is required.` }, { status: 400 });
      continue;
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `${file.name} is larger than 5 MB.` }, { status: 413 });
    inputs[f.key] = await file.text();
    fileNames[f.key] = file.name;
  }

  try {
    const run = await createRun({
      inputs: inputs as EngineInputs, fileNames, evaluationDate, createdBy, source: "upload",
      label: String(form.get("label") ?? "").trim() || `SAP export uploaded by ${createdBy}`,
    });
    return NextResponse.json({ id: run.id });
  } catch (e) {
    if (e instanceof FreshrootsError || e instanceof ConfigurationError) {
      return NextResponse.json({ error: e.message, type: e.name }, { status: 422 });
    }
    throw e;
  }
}
