# Sumter template and implementation workspace

A working staff application for authoring procurement templates, reviewing exact source revisions, freezing implementation releases and recording the receiving platform's actual configuration. It extends the original Sumter template compiler and preserves the original seven proposed template families, issuer references and vendor-side implementation proposal.

Updated 2026-10-11 from the complete issuer RFQ and Addendum One. The workspace supports the implementation workshare described below; the prime remains responsible for its software offering and district submission.

## Run the staff workspace

Use Python 3.12 or later and Node 22 on Linux or macOS. Both parts use their standard libraries. Run these commands from this directory:

```sh
python3 -m workspace --data workspace-data init
python3 -m workspace --data workspace-data bootstrap --name "Named administrator"
python3 -m workspace --data workspace-data serve --port 8775
```

Bootstrap prompts privately for a password of at least 16 characters. Open `http://127.0.0.1:8775`, sign in and create named authors and reviewers in **Operators**. The server binds to loopback. A managed TLS reverse proxy can supply an exact browser origin through `serve --origin https://your-workspace.example`; the same origin is used for host, session and request checks.

| Work area | Retained operational result |
|---|---|
| Template and clause library | Add reusable templates beyond the seven initial proposals; save immutable source revisions, attach original files and record named reviews. Projects pin the selected revision until an author explicitly adopts a newer one. |
| Project authoring | Prepare Solicitation and Contract records, select templates, enter their actual fields and assign project access. Named section locks and revision checks preserve concurrent edits: separate sections merge, conflicting changes to the same section remain for the authors to resolve. |
| Sources and approval | Retain the original bytes and source reference of each file. Select internal, public or withheld handling and template destinations. Configure ordered, named review stages for the exact current content. |
| Frozen implementation | Download the original compiler output, source and role maps, selected attachments and review history in an immutable implementation archive. A separate publication copy contains only explicitly selected public content. Amendments identify their exact parent release. |
| Receiving platform handover | Record the platform, environment, native project, module and template identifiers; map every field, clause, attachment and approval role; retain the actual native review or export; and record the named acceptance decision. Internal exercises are identified separately in the record and exported handover. |
| Continued operation | Reopen projects, inspect historical changes, retain earlier releases, and transfer the complete business workspace. Transfers preserve names and history while removing passwords and sessions. Restore creates a new directory and requires an explicit local access reset. |

The initial workspace contains the original proposed template blueprints. It does not preload customer clauses or reviews. Follow the [operator guide](workspace/docs/OPERATOR_GUIDE.md) and [initial project playbook](workspace/docs/INITIAL_PROJECT_PLAYBOOK.md). The [source inventory](workspace/docs/issuer-sources.json) identifies the exact issuer PDFs and the [starting context](workspace/docs/initial-project-context.json) supplies source-based field references for the initial RFQ preparation.

**Transfer and restore:** an administrator downloads **Transfer complete workspace** from Projects. On the receiving machine, run:

```sh
python3 -m workspace --data restored-workspace restore --archive original-workspace-transfer.zip
python3 -m workspace --data restored-workspace reset-access --name "Named administrator"
python3 -m workspace --data restored-workspace serve --port 8775
```

The restored name must match an original administrator. Re-enable the other retained operators deliberately and set their private passwords through the same local `reset-access` command. Keep the transfer archive within the established private business-file handling process; it contains the retained source and project records.

Each attachment can contain up to 20 MiB. Templates and clause records have no fixed library-count limit. Compilation uses the original Node renderer, and the browser uses the same persistent SQLite authority as the downloads and handover records.


## What changed after reading the original source

The 20-page RFQ, issued October 2, seeks an integrated sourcing, vendor and contract-management system. Its Section III (PDF page 12) includes document templates and a clause library, solicitation management, evaluation, contracts, insurance, public-works bidding, emergency-vendor information and a transparency portal. Training, security/privacy, support, incident reporting, logging and password policies appear on PDF page 13.

The seven-page **October 9 Addendum One** materially narrows the useful services pitch:

| Source location | Issuer statement, paraphrased | Delivery consequence |
|---|---|---|
| Q11, printed p4 / PDF p6 | At least five to seven templates need configuration. | Offer actual template/clause configuration rather than a test-only report. The issuer did not specify the seven template names in this kit. |
| Q15, printed p4 / PDF p6 | A library of the district's own past solicitations, templates and clauses is acceptable. | A district-owned reusable library is useful; a nationwide repository is not necessary to this workshare. |
| Q3–4, printed p1–2 / PDF p3–4; Q6 | Several access categories are answered with two users; no test-environment requirement is stated. | Plan a small operator handover; do not assert two distinct total users or make a new test tenant a buyer requirement. |
| Q5, printed p2 / PDF p4 | No AI features at this time. | Remove the AI upsell despite broader wording in the original specification. |
| Q8–9, printed p3 / PDF p5 | This is new to the organization; file/record counts are not provided. | Do not price invented migration volumes. Inventory actual approved inputs first. |
| Q10, printed p3 / PDF p5 | No third-party integration is required; attachments are needed; API availability is unconfirmed. | Use supported operator configuration; do not invent an API connector requirement. |
| Q12, printed p4 / PDF p6 | Workflow quantities are unknown. | Proposed workflow mappings are scoping aids, not issuer-mandated counts. |
| Q17, printed p5 / PDF p7 | A differently delivered equivalent feature is answered as nonresponsive. | Prime must establish exact platform fit; this kit is not a substitute for mandatory software capability. |
| Q19, printed p5 / PDF p7 | Follow the original closed-bid submission instructions. | Preserve hard-copy/USB instructions; this outreach is to a potential partner, not a district submission. |

Q1 does not supply a budget. Q2's answer to the hosting/pricing-options question is ambiguous and should not be interpreted as acceptance of a particular deployment model. Q16 does not unconditionally accept uploaded bid bonds; Q18 leaves the requested vendor-application form unanswered. These are source-specific facts, not new internal stop policies. Partner discovery and preparation can continue without pretending the issues are resolved.

## Use the original compiler directly

Node 22; built-ins only. No installation, network, platform API, account, signature or paid resource.

```sh
node template-library.mjs inspect
node template-library.mjs render --context example-context.json --out /tmp/sumter-review-copy
node test-template-library.mjs
```

The example is visibly fictional and is not a ready-to-submit offer. The default kit produces seven editable Markdown review copies, `configuration-map.json` and `HANDOVER.md`. Use `--kit PATH` for another validated library and `--templates template-id,another-id` to select the required families. The staff workspace supplies its exact pinned kit and selected content to this same renderer. It escapes input Markdown/HTML, copies operator-supplied text literally and reports unresolved fields/clauses rather than manufacturing them. Output directories are create-only; existing output is not overwritten. Generated files use private file modes where supported.

`template-kit.json` contains seven **proposed** families: request for information, request for quotation, invitation for bid, request for proposal, addendum/Q&A, contract administrative record/renewal notice, and award/public summary. The count is grounded in Q11; these names are our initial configuration proposal. The contract record is not drafted legal contract language. Actual agency-selected templates can differ.

For real preparation, copy the context, change `mode` to `operator`, populate its `fields`, and provide the actual selected clause `text`, `source_reference` and `approved_by` attribution. Remove unknown entries instead of inventing approval. Missing entries remain explicit in review copies and the configuration map. A zero unresolved count is **input completeness only**, not proof of authority, legal sufficiency or platform conformance.

The map connects each template to required fields, selected clause keys, attachment prompts, proposed operator workflow and content hash. All platform-configuration entries initially read `NOT_PERFORMED`; an authorized implementer transfers reviewed content through the chosen platform's supported interface and records the actual native template IDs through the workspace handover form. This tool does not claim an OpenGov import format or live deployment.

## Paid implementation proposal

**Commercial discussion basis: $3,500 fixed / five business days**, starting after the partner agrees the scope and provides its authorized platform access plus approved source text. This is our proposed services price, not the district budget, an accepted SOW or revenue.

The work package covers selection and preparation of up to seven templates; a source-attributed clause/library map; hands-on configuration in the prime's selected platform using its supported interface; attachment and role mapping; a two-operator walkthrough; and editable handover/export material where supported. Confirm the final selected templates with the partner. No new test tenant is assumed or required by this proposal.

| Workday | Implementation output |
|---|---|
| 1 | Selected template inventory, approved-source register, field/role/attachment map; unresolved source inputs separated from completed content. |
| 2–3 | Up to seven native templates configured in the agreed environment, linked to actual approved clauses and documents; preserve native template identifiers. |
| 4 | Operator walkthrough of prepare/review/amend/archive/publish processes; correct practical permission and attachment problems encountered. |
| 5 | Transfer editable source/configuration map, platform-supported exports, operator notes and remaining implementation items. |

Excludes platform licensing, a replacement procurement platform, bidder representation, buyer submission, generative AI, third-party integrations, unquantified bulk migration, legal drafting, formal security certification, or guarantees that the selected vendor is responsive. The prime retains bid, pricing, licensing and vendor-representation decisions. Routine functional checks support the configured deliverable; they are not the whole product.

## Buyer / vendor / relationship facts

The district deadline remains **October 23, 2026 at 11:00 a.m. as stated in the issuer documents**. The question deadline was October 9 at 11:00 a.m. The cover and Addendum require one hard copy and one USB copy in the specified sealed-offer process; an emailed partner inquiry is not a bid. The estimated contract dates in the original are not a confirmed award/start date.

Greenville County Schools' own page documents an OpenGov procurement deployment, and Vertosoft publishes its OpenGov commercial contact. This supports a relevant partner inquiry, not a statement that Vertosoft/OpenGov is pursuing Sumter or that its current software meets every RFQ requirement. There was earlier outreach to that commercial channel on a different opportunity; keep the relationship context and do not treat it as a never-contacted organization. Current outbound custody and private message identifiers belong in the original internal sales thread, not public source.

The old `acceptance_matrix.csv` is retained as historical design material, not the current commercial scope or a set of tender requirements. `lead_state.json` tracks source/product facts; delivery and responses must not be inferred from the existence of these files.

## Original sources and reproducibility

- Issuer advertisement: <https://scbo.sc.gov/printad?a=69282>
- Issuer solicitation index: <https://finance.sumterschools.net/procurement/solicitations>
- Original RFQ, 20 pages: <https://drive.google.com/file/d/1J_ubcwLrU-bdbGnvEHooerM4R7FrolVB/view>
  - SHA-256 `90dbc9f5507696df56604185857f2b91709451a676ea486b1a659575e5a908c8`
- Issuer addendum index: <https://finance.sumterschools.net/procurement/addendums>
- Addendum One, October 9, seven pages: <https://drive.google.com/file/d/1p7WwFwUvGP8BD4wDqRiMb22hVqRzaRHC/view>
  - SHA-256 `81c7b68cb1a071a746fdcee2dbd75a1b9648fa7ab49f08113f908ebcd36861b8`
- Independent school-district platform example: <https://www.greenville.k12.sc.us/Departments/main.asp?titleid=solicitations>
- Published supplier channel: <https://vertosoft.com/opengov-2/>

The complete PDFs were retrieved through the authenticated Drive connector, extracted without OCR and key original/addendum pages rendered for visual review. Recheck the issuer's addenda before a prime finalizes its bid; do not treat this dated snapshot as a perpetual deadline monitor.

## Reusable revenue workflow

Start from an active, original buyer request. Read the full package and amendments, not just an ad. Match a real supplier using first-party product/sector evidence. Identify a separable implementation burden the buyer actually describes. Build a usable starter around that burden, preserve prior-contact context, and send one relevant commercial inquiry through the existing relationship channel. Record actual sends/replies internally; move to priced implementation only when scope is agreed. Measure accepted work and paid invoices, not drafts or document counts. No automatic follow-up cadence is created by this kit.
