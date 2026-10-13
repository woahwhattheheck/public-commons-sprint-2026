# Approved World Bank source intake

Open **Receive approved handover** in the existing Analysis application's World Bank tab. The intake receives the complete approved ZIP into the same customer workspace, validates it through the original World Bank importer, and registers a typed document with its original source, review, provider capture and handover attached.

## Customer workflow

1. Select the original complete handover ZIP produced by the World Bank source workflow. The native importer accepts at most 32 MiB.
2. The application records a stable intake ID and full SHA-256 before upload. It receives 256 KiB chunks; a lost response can repeat the exact chunk. Reopen the intake and select the same file to continue.
3. The original source importer and typed projection validate all observations and retained review. Exact numeric text, nulls, selection, capture metadata and exclusions remain in the registered document.
4. Inspect the complete source metadata and original review. **Review in customer programmes** returns to the shared World Bank tab and selects that exact source revision, including older paginated sources.
5. Select the customer's saved programme and prepare its source review. The existing comparison, explicit source selection, customer-edited report, workbook refresh and portable delivery remain authoritative.

The intake keeps the customer's accepted view and saved SQL/report/workbook definitions unchanged. Customer edits belong in their original editors. A reviewed exclusion from a retained provider capture is presented as a review change.

## Continue interrupted work

Intake requests, chunk identities, registration attempts and registered source identities live in the original Analysis SQLite database. Each private staging chunk is atomically saved before its corresponding database update. Exact replay reconciles a lost response without allocating another intake.

The browser retains its intent before the first write. If registration succeeds but the reply is lost, the same intake resolves the existing source instead of incrementing or replacing its revision. A different file uses **Start another intake**.

Registration uses the already-open Analysis owner through WorldBankAnalysis.active_workspace. The single intake coordinator drains before the native source/import/archive engines close. Validation errors and prior attempts remain visible. **Continue source registration** repeats the original source operation with its original handover and native engine inputs.

## Complete transfer and receiving

A registered source is stored in the existing content-addressed document store with its original approved handover. The standard Analysis archive includes every registered source revision, its full original files and the additive intake history tables. Intake downloads resolve that document inside the current workspace and verify its content address, without depending on an absolute producer path.

Receive the full Analysis archive through the original workspace_archive_receive command and open the resulting installation through the existing Analysis application. Registered intake history and original handover downloads remain available. Same-operation archive replay verifies its retained original document/response files while preserving later customer edits.

An unfinished upload has not become a registered source. Its history travels in the SQLite snapshot; unregistered staging chunks remain local. In another installation, the intake reports actual available bytes and accepts the same original handover to continue. Prior chunk identities remain binding.

## Source integration

WorldBankProgrammes remains the sole customer programme/history manager. WorldBankRecurring remains the reviewed source/report/workbook orchestrator. The intake subclass overrides only the original adapter's post-projection hook, registering a document and returning its actual revision. It does not implement another dataset engine or run generated reports.

Additive service:
stellar_forge_buyer.worldbank_intake.WorldBankIntake(workspace, core=installed_core)

The workspace constructs it after WorldBankProgrammes, using that manager's installed core path, and closes it before closing native engines. The complete accompanying Analysis and World Bank tab postimages add its lifecycle, routes and source-selection return. Compose them with newer shared files rather than reverting the live application.

Private route contract:

| Method | Route | Operation |
| --- | --- | --- |
| GET | /api/worldbank-intake?before=SEQUENCE&limit=25 | Paginated original intake history |
| POST | /api/worldbank-intake | Begin id/bytes/sha256/filename intent |
| GET | /api/worldbank-intake/ID | Current status, input and result |
| POST | /api/worldbank-intake/ID/chunks | Exact offset/sha256/base64-content chunk |
| POST | /api/worldbank-intake/ID/register | Registration, with resume for a prior failure |
| GET | /api/worldbank-intake/ID/original | Verified complete original handover |

IDs are stable 32-character lowercase hexadecimal strings. The browser supplies no executable source path. Source names use the full intake ID; an existing differing registration is preserved and reported.

The handler uses the original host/Origin/X-Analysis-Capability checks, JSON size limit and descriptor-based download. The packaged Python _analysis_worldbank_intake_ui module embeds all three exact frontend bodies, following the original Analysis packaging contract. The product directory retains their editable source counterparts. Include all three additive Python modules and the product directory in the installed source selection; generic wheel serving has no checkout-path dependency.

## Original receiving course

FE85 retains the actual complete World Bank acquisition and recurring customer receiving operation. Its original capture has 42 observations; its second approved handover uses a reviewed single-observation exclusion with byte-identical provider pages. The joined course receives that complete approved ZIP through this intake, resolves the returned source in the existing programme picker, completes the native reviewed customer refresh, exports the whole workspace, receives it independently and downloads the exact registered original again.
