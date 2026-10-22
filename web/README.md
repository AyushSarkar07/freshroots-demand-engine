# Freshroots Reorder Desk

The web app for the Freshroots demand-planning engine (MESA Case 01). It is built with Next.js 16 and deployed on Vercel.

Twice a week, the analyst uploads the SAP export. The engine applies Raghav's documented rules to every SKU, and Gemini drafts a short brief. Procurement then approves, edits or rejects each reorder. Approved lines are exported as CSV, one purchase order per distributor, for import into Zoho Inventory. The app never sends anything to a supplier.

## Pages

| Page | What it's for |
|---|---|
| `/` Decisions | The planner brief, KPIs, and one row per SKU showing weeks of stock against its allowed range, demand, what the engine recommends, and the person's decision |
| `/sku/[id]` | Why the engine decided what it did, weekly sales against the 12-week and 4-week averages, the numbers behind the decision, data checks, and decision history |
| `/orders` | Approved lines grouped by distributor, override rate, pending decisions, and CSV export |
| `/data` | Upload a new export, run history, input file fingerprints, the data-quality report, and the activity log |
| `/rules` | The rules in plain English, with the thresholds the run used |

## How it fits together

- **Engine.** `src/lib/engine/` is a TypeScript port of `../freshroots_engine.py`. `tests/parity.test.ts` checks that both engines produce identical decisions, data-quality records and explanations on three datasets: the real export, the sample data and a deliberately messy fixture. After changing either engine, regenerate the golden files with `../.venv/bin/python ../scripts/export_golden.py`.
- **Brief.** `src/lib/brief.ts` builds the brief. Gemini writes it from the engine's facts. If the draft contains any number the engine didn't produce, it is replaced by a template. With no API key, the template is always used.
- **Decisions.** `src/lib/decisions.ts` handles decisions. Each one stores a name. Changing or rejecting a reorder requires a reason, and those changes count towards the override rate.
- **Storage.** `src/lib/store/` uses Postgres when `DATABASE_URL` is set and memory otherwise. The tables (`runs`, `decisions`, `events`) are created on first use.
- **Notifications.** `src/lib/notify.ts` sends a Telegram message to procurement when a run lands. Without the Telegram keys it is simulated, and the activity log records what would have been sent.
- **First run.** On first use, the app creates a run from the bundled SAP sample export in `data/`.

## Develop

```bash
npm install
cp .env.example .env.local   # optional; everything works without keys
npm run dev
```

```bash
npm test && npm run typecheck && npm run lint
```

## Deploy

Vercel project `freshroots-reorder-desk` on team `mesa-dbb9`. Deploys use the committed tree only.

```bash
scripts/sync-secrets.sh   # copy .env.local values to Vercel production
scripts/deploy.sh         # git archive HEAD:web -> vercel deploy --prod
```
