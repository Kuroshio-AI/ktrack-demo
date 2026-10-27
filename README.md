# KTrack demo

KTrack (Kuroshio Track) is a local-first Kee Safety operations console for fictional register data. The default route is `/dashboard`; records, inspections, alerts and certificates are stored in one versioned `localStorage` document. EmailJS and Meta WhatsApp Cloud API are available only for explicitly requested single-alert actions; there is no database or background messaging integration.

## Setup

Use Node 24.x.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The token secret must be at least 32 characters. `NEXT_PUBLIC_APP_URL` is used to build QR verification URLs; when omitted in development, the request origin is used. Never expose `DEMO_CERT_TOKEN_SECRET` or the Meta variables to the browser. EmailJS uses the three `NEXT_PUBLIC_EMAILJS_*` values; outbound WhatsApp requires `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`, and `META_WHATSAPP_TO` in the server environment. `META_WHATSAPP_TEMPLATE_NAME`, `META_WHATSAPP_TEMPLATE_LANGUAGE` and `META_GRAPH_API_VERSION` have safe defaults. Leave the channel values unset to keep WhatsApp disabled.

Run the focused checks with:

```bash
npm run typecheck
npm test
npm run build
```

## Five-to-seven-minute walkthrough

1. Start on Dashboard. Open **Demo Controls** to download **Filled sample 1** for inspections and approvals or **Filled sample 2** for renewals and retirement, then upload it in **Import**. You can preview either sample from its link; both use the visible demo date, contain six records and have no inspection history until you create it through the workflow.
2. Review the six valid rows and click **Import valid rows**. Open Dashboard to see the 30-day, 7-day, today and overdue queues.
3. Open Inspections, choose an active record, complete the checklist and submit it. A Reviewer or Admin can return it with a mandatory comment, or issue a certificate with an explicit expiry.
4. Open Certificates to print a branded DEMO certificate, create a QR snapshot and open the public `/verify?token=...` page. Tokens are signed, immutable payloads with a 24-hour TTL.
5. On Alerts, an Admin, Engineer or Reviewer can click **Send email** on one alert. The EmailJS template has fixed To `devops@kuroshioai.com` and CC `noufal@kuroshioai.com`; KTrack sends only when you click and has no automatic or bulk send action.
6. Open **Demo Controls → WhatsApp Cloud API** to check the server-selected template and masked recipient. On Alerts, click **Send WhatsApp alert** on one alert. KTrack sends only the five approved alert details and records local API acceptance; delivery remains unconfirmed.
7. Use Demo Controls to download blank templates, set the app-only date, exercise deadline tiers, submit an explicit all-pass scenario, or reset the demo after confirmation. Reset returns to the empty Dashboard.

Production demo: [kuroshio-ktrack.vercel.app](https://kuroshio-ktrack.vercel.app) (the old keetrack.vercel.app address still works) · source: [github.com/Kuroshio-AI/ktrack-demo](https://github.com/Kuroshio-AI/ktrack-demo). This repo is the sales demo; the production build lives in the private Kuroshio-AI/ktrack repo.

## AMS profile (drill pipe inspection)

`NEXT_PUBLIC_CLIENT=ams`, or `npm run dev:ams` on port 3002, builds a drill pipe inspection demo for Al Mansoori Inspection Services. Its pages are Dashboard, Tally sheets, Approvals, Reports, Connections, Damage criteria, Equipment, Alerts, Sustainability and Demo Controls.

- **Dashboard** lists what needs doing, most urgent first: tally sheets returned for correction, expired instruments and how many sheets they block, sheets waiting for approval or ready to submit, sheets still being measured with their progress, calibrations due within 30 days and reports about to expire. Each row opens the page where the work is done, and `/inspections?sheet=<id>` opens one sheet.
- **Connections** is the dimension table: one row per size, weight, connection and grade, with the Premium min and/or max for each dimension in inches and, where the table has them, the Class 2 limits. It imports from Excel through the template's columns (`Size`, `Weight`, `Connection`, `Grade`, optional `Standard` and `Unit`, then `<dimension> min`, `<dimension> max`, `<dimension> class 2 min` and `<dimension> class 2 max`). A blank size, weight, connection, standard or unit repeats the row above, like the printed table. A table in millimetres (`Unit` mm) converts to inches, each limit rounded to the strict side. A second sheet with a `Connection` column and no `Size` holds limits that depend only on the connection, like API RP 7G-2 Table C.7, and they join every row with that connection. RP 7G-2 names (Tool joint OD, Counterbore diameter, Pin base length and so on) fill the matching F.582 columns. An imported row replaces the one with the same four keys.
- **Tally sheets** follow form F.582: one line per pipe with the pipe body (length, ID coating, OD condition, remaining wall), 11 box tool joint columns and 11 pin tool joint columns, a limits row from the dimension table, and the form's condition codes (SD, TD, PT, ... CRK, plus BENT). Opening a job creates its record and keeps its own copy of the connection's limits, so a later import never regrades it. `lib/tally.ts` suggests each pipe's class as it is typed. A reading past its Premium limit but within Class 2 makes the pipe Class-2, and past Class 2 Scrap. A dimension with no Class 2 limit is a connection dimension, so failing it is Premium-Rework (a box OD without one still gives Class-2). Remaining wall is Premium from 80% of nominal and Class 2 from 70%. Condition codes grade by the damage criteria, the worst outcome wins, and a field-repair code keeps the class and counts as a repair. Values compare at three decimals and a value on the limit passes. Each pipe's class and the reason sit pinned next to its ID, and the inspector overrides the class there. Code cells are blank for OK; typing a code (`td` becomes `TD`) records a defect, and an unknown code is refused. The summary numbers above the grid filter it to those pipes. Tab moves across, Enter moves down, and a block pasted from Excel fills from the cell it lands in. Add pipe, under the grid, adds a pipe at the end, and an empty last pipe can be removed. A draft is deleted from its row in the jobs list, which also frees its work order number.
- **Damage criteria** lists each condition code with what the inspector looks for and what it does to the pipe: Field repair, Rework, Class 2, Bent or Scrap. Admin and Manager change the wording and the outcome. A change regrades tally sheets in Draft or Returned; a submitted sheet keeps the criteria it was graded with. The demo's wording is made up and marked Sample wording.
- **Equipment** lists the instruments with model, serial, last calibration and next due date, soonest due first. Admin and Manager add instruments (serials must be new). Record calibration takes the date it was done and the next due date from the certificate (a year on by default) and logs it. Each tally sheet records which ones it used; it can't be submitted while one is past its date, and the submitted sheet keeps a copy of the list. Instruments due within 30 days raise an alert.
- **Reports** follow form F.581. Approving a complete tally sheet issues a numbered report, valid for six months by default. The printed report (page 1 A4 portrait, the tally A4 landscape) fills the header, inspection programme and services, material, the results table (each class split into rework and field repairs by box and pin), the down-graded pipes with reasons, the equipment details and signatures, then the full tally on a landscape page. The QR verify page names it an inspection report.
- **Sample data.** A new browser, or Reset in Demo Controls, opens on made-up sample connections (`Sample 50`), nine instruments (one due for calibration), one issued job and one tally sheet with planted findings and three pipes left to measure. The client's own dimension tables are DS-1 and API RP 7G-2 content, licensed, so they never go in this public repo: keep them in the git-ignored `contextforclient/` and import them in the browser, from Connections or from the Dimension table card at the top of Demo Controls.

## FLS profile (second client)

The same code also builds a Fire & Life Safety certificate tracker for a Dubai facilities client. Set `NEXT_PUBLIC_CLIENT=fls` at build time, or run `npm run dev:fls` locally on port 3001. That build has seven pages: Dashboard, Buildings, PPM checklists, Approvals, Alerts, Import and Demo Controls. It shows no Kee branding. Without the flag the Kee demo builds exactly as before.

- **Import** reads the client's own `FLS DCD (AMC) certificate tracker` .xlsx as it is. That means the title block, the header row (`Sl. No`, `Building`, `Frequency`, `Date of Issue`, `Date of Expiry`, `Days Remaining for Expiry`, `Due Date`, `Days Remaining for Due Date`, `Service Provider`, `Remarks`) and the label rows that start a new group of sites. Days remaining and the due date (expiry − 15) are worked out again, never read from the sheet. When an updated sheet is uploaded again, it updates the buildings already in KTrack.
- **Muting.** A building is muted when its provider is `NOT Under Us`, or its remarks say Closed, Under Renovation or Client will renew. Muted buildings never alert. You can toggle it per building.
- **Colours** follow the sheet: green from 15 days, amber 1 to 14, red on the day and after.
- **Alerts** come 30 days, 15 days (the due date), 7 days and 0 days before expiry, and again once overdue. The Dashboard digest card holds the morning message and opens it in WhatsApp or email to send by hand. There is still no scheduled or bulk sending.
- **WhatsApp.** The FLS deployment sends its own approved `ktrack_fls_alert` template (set with `META_WHATSAPP_TEMPLATE_NAME`) from the same number as Kee. Its five parameters are the event, building, category, severity and due date, in the order the app already sends.
- **PPM checklists** are the service provider's maintenance forms for 12 systems (fire alarm, sprinkler, hose reel, hydrant, suppression, electric, diesel and jockey pumps, breeching inlet, emergency lighting, extinguishers, zone control valves), kept in `lib/fls-checklists.ts`. Each item is answered Ok, Not Ok or N/A, on the laptop or a phone. The client representative approves it in Approvals; no certificate is issued, and Not Ok items stay on the record. The CBS battery readings sheet and the two location lists aren't included.
- **Client data.** The client's files stay in the git-ignored `contextforclient/` folder. Never commit them: this repo is public.

## Register format and limits

`.xlsx` files contain a worksheet named `Register`, a worksheet named `Savings`, or both. CSV files use the same fixed UTF-8 headers in the template: `asset_ref`, `record_type`, `asset_type`, `site`, `owner`, `serial_no`, `assigned_engineer`, `inspection_due_date`, `inspection_interval_months`, `licence_expiry_date`, `certificate_no`, `certificate_issued_date`, `certificate_expiry_date`, `retirement_due_date`, `status`. `asset_ref`, `record_type`, `asset_type`, `site` and `owner` are required. Date values are stored as calendar strings (`YYYY-MM-DD`), certificate fields are all-or-nothing, and certificate expiry cannot precede issue. Formula cells, malformed layouts, duplicate trimmed case-insensitive asset refs, files over 2MB and imports exceeding 500 total register records are rejected or reported per row. Duplicate rows never overwrite existing records.

Sustainability savings use the layout the Sustainability page exports: `certificate_no`, `quarter`, `date`, `type`, `description`, `quantity`, `unit`, `kg_co2e_per_unit`, `kg_co2e_saved`, `cost_saving_usd`, `site`, `evidence`, `issued_date`. `quarter`, `kg_co2e_saved` and `issued_date` are worked out again on import. In a CSV the savings block follows the register after a blank row, starting at its own header row; the Demo Controls templates and both filled samples carry both. A known certificate number, or the same type, date, quantity and description, is skipped rather than overwritten, and every new saving gets the next `ENV-<year>-<seq>` number.

The browser saves a complete next-state JSON document before updating the visible state. Unsupported or corrupted stored data enters recovery mode and blocks ordinary writes until **Start fresh** is explicitly confirmed in Demo Controls. Reset clears only KTrack’s operational local data.

Inspection evidence is optional fictional demo data. Only image MIME types are accepted, with a 200KB per-image and 1MB total local cap. No inspection or approval history is invented by register import.

## Verification snapshots

Creating a QR calls `POST /api/certificates/demo-token` with a small allowlisted certificate snapshot. The API signs it with an HMAC secret and returns a verification URL. `/verify?token=...` displays the captured status, dates and `asOf` timestamp; it is not a live certificate lookup. Old tokens remain valid until their own expiry even if a certificate is later revoked or superseded. QR generation can be retried without changing the approved certificate.

Future integrations such as a database, automated outbound delivery, customer identity and real certification evidence are intentionally outside this demo.

## Manual alert email

EmailJS uses the browser REST endpoint only after a user clicks **Send email** on an individual alert. The template has fixed To `devops@kuroshioai.com` and CC `noufal@kuroshioai.com`; KTrack sends only the alert event, asset reference/type, site, owner, severity, due date, demo date, status and occurrence timestamp. Notes, inspection evidence and contact lists are never included. The shared EmailJS account and mailbox quota are a demo dependency, so configure the three public values in `.env.local`, do not commit account values, and expect no scheduled or background delivery. A provider acceptance is recorded in localStorage; network failures remain unconfirmed and require a deliberate manual retry.

The provider template is versioned at [`docs/emailjs-template.html`](docs/emailjs-template.html). Keep its settings as follows: subject `[KTrack Demo] {{event}} — {{asset_ref}}`, fixed To and Reply-To `devops@kuroshioai.com`, fixed CC `noufal@kuroshioai.com`, From Name `KTrack Demo`, the default EmailJS sender, blank BCC, and no auto-reply. Keep the template body limited to the allowlisted fields above.

## WhatsApp Cloud API

The WhatsApp action is a manual, one-alert operation. The browser posts a same-origin JSON allowlist to `/api/alerts/whatsapp` with `alertId`, `event`, `assetRef`, `site`, `severity` and `dueDate`. The browser derives those values from the selected alert and its matching local record, sends no owner, notes, evidence, contact list or arbitrary message body, and never chooses the recipient, phone number ID, template or Meta access token. Missing asset, site or due date values are sent as `Not applicable`.

The server requires `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID` and `META_WHATSAPP_TO`. Sending is deliberately unauthenticated: anyone using the public demo can send an alert, but only to the fixed recipients, with the guards below. `META_WHATSAPP_TO` holds one number or several separated by commas, and each alert goes to all of them. If only some numbers accept, the result stays unconfirmed so a retry can't message the others twice. `META_WHATSAPP_TEMPLATE_NAME` defaults to `keetrack_asset_alert`, `META_WHATSAPP_TEMPLATE_LANGUAGE` defaults to `en_US`, and `META_GRAPH_API_VERSION` defaults to `v26.0`. Keep all of these values in the server environment, never in browser code or the repository.

To replace an expired access token without a redeploy, connect Upstash for Redis from the Vercel Marketplace so the project has `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Demo Controls then shows a **Meta access token** box. Anyone can submit it, but a token is saved only after Meta confirms it can use `META_WHATSAPP_PHONE_NUMBER_ID`, so only someone who already controls that number can change it. The saved token lives in Redis, overrides `META_WHATSAPP_ACCESS_TOKEN`, and is never returned to the browser.

The approved template must have these five body text parameters in this exact order:

```text
KTrack maintenance alert for your registered equipment.
Event: {{1}}
Asset: {{2}}
Site: {{3}}
Severity: {{4}}
Due date: {{5}}
Please review this item in your KTrack register.
```

The template name, language, parameter order and approved category are ultimately controlled by Meta. A successful response with a valid WhatsApp message ID means Meta accepted the API request; it does not confirm delivery. Network, timeout and malformed-provider responses remain unconfirmed and are cached so the browser does not automatically retry an ambiguous request. 4xx responses are redacted as provider rejection. Accepted and ambiguous results use a bounded warm-instance replay cache for 10 minutes, with a three-second per-instance cooldown and a maximum of 500 alert keys. These module-local guards are not full customer authentication or a durable global quota; cold starts and multiple instances can reset or bypass them. There are no scheduled, background or bulk sends.

For production, complete the local Meta app and business onboarding/migration before deployment and use a separate production sender. Keep the user's existing WhatsApp Business phone app number outside this migration. The deployed Meta app must be published, have the WhatsApp Business Account connected, and subscribe to the `messages` field for webhook callbacks. Configure the fixed recipient and approved `keetrack_asset_alert` template in the production server environment.

## WhatsApp webhook

The optional `/api/webhooks/whatsapp` route supports Meta's verification challenge and signed event callbacks. Set `META_APP_SECRET` and `META_WHATSAPP_VERIFY_TOKEN` in the server environment, then configure that callback URL in the published Meta app. GET verification compares the token in constant time and returns the challenge as plain text. POST requests are accepted only with a valid `X-Hub-Signature-256` HMAC over the raw request bytes and a basic WhatsApp event envelope; unsigned callbacks are rejected.

This demo authenticates and acknowledges valid callbacks only. It has no backend database: callback events are not persisted, do not trigger inbound replies or automatic messages, and are not used to mark local alerts delivered. Delivery remains unconfirmed in KTrack even when a webhook callback is received. Alert sending has no authentication or durable global rate limiting, so this flow suits the controlled demo only.
