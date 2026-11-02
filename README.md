# Fastener ERP demo

A working demo of the Fastener ERP that MacanX is building for West Coast Corrotech Service LLP (WCCS), Fastener Division. It follows the Scope of Work v1.0: client PO to invoice, in the nine stages of the plant, on one stock ledger.

Everything runs in the browser on sample data. There is no server; changes stay in the visitor's browser and **Reset demo data** (role menu, top right) restores the sample plant.

## What is in it

| Area | What works |
|---|---|
| Sales orders | Client PO, BOQ entry and **Paste BOQ from Excel** with item matching, MT→pcs conversion, sourcing split (made / bought finished / bought semi-finished) with reason, feasibility and promise date, approval, versioned amendments, short-close, and the **SO status board** with the balance at all 10 steps for every line |
| Planning | Net requirement from open SO lines, planned work orders per operation on the least-loaded machine that runs the size, **drag-and-drop machine × shift board** with load against hours, size-range checks, PM and breakdown blocks, overload override for approval, RM shortage |
| Purchase | Indents (for an SO or for stock) showing stock, open POs and last price, BOM limit check, RFQ, **quote comparison** with lowest landed cost highlighted and a reason + approval for any other vendor, POs, outsourcing POs from the SO split, due and overdue by vendor |
| Inward & QC | Gate entry, weighbridge variance flag, GRN with heat and coil numbers, quality hold, mill TC checked against grade limits, physical checks, accept / accept with deviation (QC head) / reject with debit note |
| Production | Job cards with QR, heat issue with grade check against the BOM, lot issue for later operations, output capped at what the material can yield, lot numbers like `AHD-HD01-261102-D-0003` linked to heats, in-process QC with hold, close only when input = output + scrap + rejection |
| Galvanising | Batches of QC-passed lots within the kettle load limit, pre-GI check, coating check that blocks packing and sends the batch to re-dip, zinc pick-up with band alert, zinc issued from stock |
| Pack, dispatch & bill | 25 kg packs with QR labels, TPI offer and result, MDCC, dispatch capped by MDCC balance and SO tolerance, invoice at SO rates capped by SO balance |
| Across the plant | Stage-wise stock in kg and pcs from the ledger, the ledger itself, physical count adjustments for approval, **traceability** pack → invoice → MDCC → TPI → GI batch → lots → machine and operator → heat → GRN → mill TC, and heat → customers |
| Maintenance & controls | Breakdown tickets and restore with spares, PM schedule with due and overdue, MTTR, PM compliance, downtime with reasons, daily roster, OEE by machine, output by operator |
| Management | Plant dashboard, **all 43 reports** with each area's key measure, approvals inbox per role with the default approval matrix, masters (items, grades, BOM and routing, machines, parties, employees, reason codes) |
| Roles | Switch between the 13 roles from the top bar; menus and approvals follow the role. Plant switch for Ahmedabad and Mundra SEZ |

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # 28 tests on the plant rules and the sample data
```

## How the demo is built

- `src/lib/plant.ts`: pure plant arithmetic (kg↔pcs, lot and document numbers, yield cap, job card balance, zinc pick-up, coating spec, weighbridge, dispatch cap, OEE). Covered by `plant.test.ts`.
- `src/lib/inventory.ts`: the stock ledger. Only this file writes stock movements; stock anywhere is the sum of ledger rows.
- `src/lib/actions.ts`: every business action and its rules. A refused action returns the reason and changes nothing.
- `src/data/seed.ts`: the sample plant. Four weeks of work are played through the same actions, so the sample data obeys the same rules a user does. Raise `DB_VERSION` after changing it.
- `src/lib/trace.ts`, `src/lib/metrics.ts`: traceability and the plant measures behind the dashboard and reports.

## Deploy on Vercel (its own project)

1. Push this folder to its own GitHub repository.
2. In Vercel, use **Add New → Project** and import it. `vercel.json` sets the build and output.
3. After the first deploy, add `DEMO_ALLOWED_HOSTS` = your Vercel address (for example `fastener-erp-demo.vercel.app`) under **Settings → Environment Variables**, and redeploy. The demo then refuses to run anywhere else except `localhost`.

The production build minifies and obfuscates the code, ships no source maps, blocks framing, and is hidden from search engines. Printed pages carry a "DEMO" watermark.
