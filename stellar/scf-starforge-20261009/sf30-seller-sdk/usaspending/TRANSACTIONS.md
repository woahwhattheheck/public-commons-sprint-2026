# Award transactions and modifications

The transaction workspace extends the original USAspending award workspace. It follows federal funding actions, preserves every original source occurrence, compares later captures by transaction identity, and binds a private workshare assessment to the retained award and transaction observations.

Open **Transactions & modifications** in the workspace navigation, or **Research transaction history** from an individual award. The browser uses the existing private session, source client, SQLite database, job controller, and recovery flow.

## Operator workflow

1. Choose a retained award edition and its original generated award identity. Search the edition by prime, award, or description.
2. Capture its transaction history. Each accepted response is retained before the next page is requested. The progress panel shows original pages, returned rows, continuation, capacity, and any provider retry time.
3. Inspect chronological actions and federal fiscal-year subtotals. Open an action's original page and request receipt. Filter modification numbers, descriptions, action types, and dates.
4. Acquire a later observation when useful. Compare captures of the same award by transaction identity. Added, changed, absent, and conflicting identities retain coverage for both observations.
5. Save a private assessment describing fit, funding changes, proposed workshare, deliverables, acceptance, relationship owner, and next action.
6. Export the original source capture, spreadsheet CSV, or combined award and workshare brief. Receive the capture into a matching retained award edition. Full workspace backup includes all original pages and every review revision.

## Official source and financial interpretation

The acquisition endpoint follows the official [USAspending transaction contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/transactions.md):

    POST https://api.usaspending.gov/api/v2/transactions/

The request carries award_id, page, limit, sort, and order. Native acquisition uses action_date ascending; imported pages retain any supported official sort and order. Page size is 1–5,000, default 250. Local capacity is up to 250,000 returned source occurrences. A paused capture can increase its saved capacity. Completion follows contiguous original page metadata and the terminal hasNext:false.

Monetary values come from original JSON numeric tokens and use decimal strings and integer arithmetic. Null remains unknown. Every transaction retains its original identity, modification, date, classification, description, obligation, loan fields, source page, source position, and record hash.

Identical repeated records remain in the source export and count once in financial totals. Conflicting records for an identity remain available as original occurrences; affected totals are unknown and comparisons report the identity as unresolved. Conflicting dates spanning fiscal years appear in every affected year, with a possible action count when the year is ambiguous.

Positive obligation, deobligation, and zero change describe the amount independently of the agency's original action description. Award details and transaction histories have their own observation times; the displayed difference compares those retained observations. Federal fiscal years begin October 1. Same-day rows use transaction identity for deterministic presentation within the source's date precision.

## CLI

Use Node 22.13+ or 24. All commands use the existing CLI and private workspace. The following paths assume the seller SDK directory:

    node usaspending/cli.mjs serve --workspace /absolute/private/workspace --port 8783
    node usaspending/cli.mjs tx-state --workspace /absolute/private/workspace
    node usaspending/cli.mjs tx-capture --workspace /absolute/private/workspace \
      --edition EDITION_ID --key ORIGINAL_GENERATED_AWARD_ID --page-size 250 --max-rows 250000
    node usaspending/cli.mjs tx-resume --workspace /absolute/private/workspace --capture CAPTURE_ID
    node usaspending/cli.mjs tx-capacity --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --max-rows 250000 --updated-at ORIGINAL_UPDATED_AT

Read and assess:

    node usaspending/cli.mjs tx-summary --workspace /absolute/private/workspace --capture CAPTURE_ID
    node usaspending/cli.mjs tx-browse --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --search MODIFICATION --start-date 2026-01-01 --end-date 2026-12-31
    node usaspending/cli.mjs tx-compare --workspace /absolute/private/workspace \
      --before EARLIER_CAPTURE --after LATER_CAPTURE --out comparison.json
    node usaspending/cli.mjs tx-review --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --revision 0 --file assessment.json

Assessment fields: status, fit, fundingChange, proposedWorkshare, deliverables, acceptance, owner, caseUrl, nextAction, notes. Status is researching, scope_match, review_with_owner, or passed. Scope match and owner review require fit, proposed workshare, deliverables, and acceptance. A save uses the current review revision to protect another operator's edits.

Export and receive:

    node usaspending/cli.mjs tx-source --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --page 1 --out original-response.json
    node usaspending/cli.mjs tx-export --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --out capture.json --include-reviews
    node usaspending/cli.mjs tx-csv --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --out actions.csv --spreadsheet
    node usaspending/cli.mjs tx-brief --workspace /absolute/private/workspace \
      --capture CAPTURE_ID --out workshare.md
    node usaspending/cli.mjs tx-receive --workspace /absolute/private/receiving \
      --file capture.json --edition ORIGINAL_AWARD_EDITION --include-reviews

Output files are create-only. Source captures include a private assessment only when requested, and receiving that assessment is explicit. Received assessments retain original operator, time, revision, and prior receiving lineage. Repeated receiving preserves local edits and reports a conflict if a different assessment would replace them.

## Retained source imports

Import the original award detail or cohort first. The transaction import JSON has a pages array. Each page contains:

| Field | Required original value |
| --- | --- |
| request | Official request object: award_id, page, limit, sort, order |
| responseBase64 | Original response bytes, base64 encoded |
| receipt.status | Accepted HTTP status 200 |
| receipt.bytes | Original response byte count |
| receipt.sha256 | SHA-256 of the original response bytes |
| receipt.finishedAt | Original observation time |
| receipt.url | Official response URL, when retained |
| receipt.request.method | POST |
| receipt.request.url | Official transaction endpoint |
| receipt.request.body | Parsed original request object |
| receipt.request.bodyBase64 | Original request bytes |
| receipt.request.bodySha256 | SHA-256 of original request bytes |

Additional original metadata, including start time and headers, stays in the receipt. The import verifies request identity, exact bytes, page continuity, monetary projection, and original award binding before writes. Pages begin at 1; a partial contiguous prefix remains resumable.

    node usaspending/cli.mjs tx-import --workspace /absolute/private/workspace \
      --edition EDITION_ID --key ORIGINAL_GENERATED_AWARD_ID --file original-pages.json

## Persistence and recovery

The original awards.sqlite3 gains five additive transaction tables. Existing workspaces open directly, and older backups restore without transaction tables. New backups carry captures, pages, normalized occurrences, assessments, and review history.

Source acceptance and its normalized rows commit together. A successful response that exceeded local row capacity remains in the interrupted operation for replay after capacity is increased. Provider retry timing is honored. Pause and resume use the original workspace job controller.

Portable captures include the initial request, capacity, original pages, projected rows, coverage, and fingerprint. A prepared capture with zero accepted pages is portable and resumable. Workspace restore checks source bytes, request/response bindings, projected rows, contiguous positions, the full copied award row, continuation, completion, fingerprints, and assessment bindings before committing.

## Native receiving journey

Run the source-driven journey with an actual retained source packet and a new output directory:

    node usaspending/transactions/run-native.mjs --source ORIGINAL_SOURCE_PACKET.json \
      --out /absolute/private/transaction-receiving

The runner imports the original award and transaction source, opens the existing private HTTP operator, saves an internal source-bound assessment, writes exports and a brief, restores the full workspace, and receives the capture into the original award-only workspace. It compares the received rows with the actual original input. The output directory contains the working customer workspace and portable receiving package.

The cumulative Stellar Forge distribution includes these runtime modules and browser assets through its existing seller SDK component.
