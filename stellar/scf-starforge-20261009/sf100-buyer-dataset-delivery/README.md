# SF100: buyer dataset delivery for original SF30 + SF88

Node 22+, MIT. A private local buyer-delivery product for a merchant who already serves a payment-protected CSV via original SF30 and uses original SF88 for **each independently approved buyer request**. This module does not send requests, approve spending, sign, settle, download seller data, call facilitators, or create new customers. The original SF30/SF88 implementation remains authoritative.

## Original-source operator flow

Use original SF30's \`dataset-cli.mjs\`, \`dataset-handler.mjs\`, \`serve.mjs\` and the existing original SF88 \`cli.mjs --review\` / \`--execute --response-out\`. Save **the actual** JSON \`stellar-forge.dataset-page.v1\` response from each separately authorized buyer operation.

From repository root, with private parent directory already created:

\`\`\`sh
S=stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery
node "$S/deliver.mjs" init --out /private/deliveries/pilot-001
node "$S/deliver.mjs" append --out /private/deliveries/pilot-001 \
  --page /private/sf88/page-001.json --intent original-approved-page-001 \
  --evidence /private/sf88/evidence-001.json
# Read the exact nextCursor reported by SF100. Review/approve another SF88
# operation independently, using this cursor in the original seller query.
node "$S/deliver.mjs" append --out /private/deliveries/pilot-001 \
  --page /private/sf88/page-002.json --intent original-approved-page-002 \
  --cursor 'PREVIOUS_SOURCE_NEXT_CURSOR' \
  --evidence /private/sf88/evidence-002.json
node "$S/deliver.mjs" status --out /private/deliveries/pilot-001
node "$S/deliver.mjs" finalize --out /private/deliveries/pilot-001
\`\`\`

Do not run \`finalize\` before the original source response's \`nextCursor:null\` and full expected row count. Every page has a distinct buyer intent and separate original buyer spending approval. There is **no automatic payment loop**. A SHA-256 of the optional original SF88 evidence file is recorded; this is not independent payment proof.

## Outputs

The session is a private, create-only 0700 directory with 0600 files. \`pages/00000.json\` etc preserve each original parsed source page, request cursor, intent and page digest chain. \`dataset.jsonl\` preserves typed projected rows. \`dataset.csv\` provides ordered columns with leading spreadsheet formula syntax neutralized for string cells. \`manifest.json\` records page and export SHA-256 hashes, source snapshot, counts, selected columns and optional original operator evidence hashes. \`review.html\` is a clean, offline industrial operator summary without merchant row data embedded into the page. Finalization is one-time; interrupted pagination can resume safely via \`status\`.

## Exact original v1 dataset contract

The loader enforces first-party \`stellar-forge.dataset-page.v1\` structure, immutable dataset \`snapshot\`, ordered declared projected fields and typed filters, row/type consistency, total, page limit and returned count. Its v1 base64url next cursor carries \`{v:1,s,q,n}\`: source snapshot, SHA-256 of the original \`{fields,filters:sortedPairs}\` query, and cumulative offset. The next archived request must have precisely the preceding cursor; different snapshots/filters/field projections, duplicated buyer intent/payload, a nonadvancing cursor, missing rows or truncated pagination fail. Legitimate identical row values are retained, not invented or deduplicated. A future revised native SF30 cursor protocol requires explicit adapter work, not bypassing this check.

Limits: ≤4,096 pages, ≤1,000,000 source rows, ≤2 MiB per original response and ≤256 MiB of combined CSV/JSONL output. Files and directories must be private. Nothing from a customer's source data should be added to GitHub. Reported HTTP status, hashes and local reviews never establish actual ledger settlement, seller authorization, accepted workshare, revenue or grant award. Review the original buyer/seller contract and original SF36 spend ledger before delivering externally. No GitHub Actions workflows or hosted CI are required.

Focused local exercise: Node 22 on Linux with two source-native-shape original \`dataset-page.v1\` responses, append/status/finalize and duplicate-append rejection. No competition simulation is claimed.
