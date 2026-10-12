# Daily cashiering and ERMA reconciliation workspace

This operator extends the existing Berkeley/Clariti permitting workspace. It retains the same SQLite database, loopback host, session token, revision checks, original case comparator and native backup/restore. The new work surface is `/cashiering/`.

The requirements and source locators are in [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md) and [requirements-catalog.json](requirements-catalog.json). The exact interface is in [API.md](API.md). The existing commercial scope and original partner conversation remain with the original product owner.

## Open the application and keep the complete state

From the product directory, run:

```sh
python3 -B workspace/app.py --db /absolute/private/berkeley-workspace.sqlite --port 8798
```

Open `http://127.0.0.1:8798/cashiering/`. The original permitting comparator remains at the root URL. Use the same application process for both surfaces.

The financial handoff ZIP contains its complete source records, mappings, calculations, allocations, corrections, dispositions, signatures, retained interface observations and runnable application source. The original **application backup** contains the full SQLite state, including permitting cases and every financial edition. Keep both when handing the complete saved workspace to another operator. The application’s existing restore command writes a new database path and opens it through the same host:

```sh
python3 -B workspace/app.py --restore /absolute/private/workspace-backup.sqlite --db /absolute/private/received-workspace.sqlite --port 8798
```

The receiving database path must not already exist.

The loopback session token changes when the server restarts. Browser reload obtains the current token. A saved request ID can recover an already committed mutation without issuing another financial write.

## 1. Define the daily comparison

Choose the business timezone, currency scales and exact date interval. Every monetary value in the engine is an integer number of declared minor units. CSV or JSON originals may contain decimal major units when the mapping explicitly declares that interpretation. Values with excess precision are rejected rather than rounded.

Choose the required source lanes from:

| Lane | Meaning |
|---|---|
| Permits | Declared permit-side transaction or event population for the selected dates |
| Receivables | Declared accounting/AR transaction or event population to reconcile with permits |
| Processor | Actual processor or settlement observations supplied for the comparison |
| Cashier | Actual cashier/session observations supplied for the comparison |

Required lanes determine whether a missing original is a finding. Cashier and processor tender applicability are separate settings. A null tender list means all declared payment types; an empty list means none. An explicit list restricts the relevant daily difference to those payment types. Inapplicable comparisons retain the observed source values and show no calculated difference.

Set any tolerated difference explicitly by currency. The default is exact agreement. A tolerance is a review setting, not a hidden rounding rule. The original permitting comparator’s per-case `paymentMinor` remains its own field; it is not substituted for the daily transaction population.

## 2. Retain originals and confirm their interpretation

Upload actual CSV or JSON exports separately for each lane. The original bytes, filename, SHA-256, acquisition time and declared coverage remain immutable. Documents such as a deposit record or a real receiving receipt can be retained as document captures.

Describe the source system, report family, event-stream or snapshot basis, dates, currencies, sessions and payment types. Mark coverage complete only when the supplied source actually supports that statement. Missing source coverage remains visible; absence is not converted to zero. Reacquiring the same original with the same source scope recovers its existing capture instead of double counting it.

The canonical column names in this application are an explicit working model. The source documents do not provide a Clariti, ACI or Munis export schema. Map each actual source column or a deliberate literal to the working fields. Retain the mapping note with the original file.

Review these choices together:

- Major units versus minor units, with the selected currency scale.
- The original sign as supplied, or an explicit event-to-sign mapping.
- Actual source event and status values, including included, pending, denied and excluded observations.
- Business-date format and exact transaction, permit, invoice, fee, session and related-transaction identifiers.
- Reported net amount versus an explicit principal-amount comparison.

A denied row can retain both the amount requested and the amount actually paid. The default financial contribution of denied, pending or excluded observations is zero; their original amounts, statuses and reasons remain inspectable. A denied source that also reports money paid creates a separate finding.

Confirm the mapping after inspecting its original and normalized rows. Invalid interpretations remain draft and explain their exact row/field problem. Mapping editions remain immutable, so an existing run does not silently adopt later column changes.

## 3. Reconcile transactions and retain corrections

Create a run from the explicit confirmed source captures and date interval. Review the native totals separately for each currency, the daily cashier/processor comparison, every unmatched group and each source finding.

Allocations connect permit-side groups to receivables-side groups. The operator chooses both original transaction groups and an exact signed amount. Partial and many-to-many allocations are supported. Both sides must use the same currency and compatible remaining direction. The engine prevents an allocation from exceeding either retained remainder.

Refunds, voids, returns and chargebacks remain separately identified source events with their supplied references. A refund authorization is not a refund payment, a returned payment is not a replacement receipt, and preparing an ERMA exchange is not posting one. Retain each actual event or document under its real meaning.

A working correction changes the interpreted run only. It records the source row, mapping edition, before/after values, operator and reason; the original bytes remain unchanged. An actual corrected export is uploaded as a new original and enters an existing run only through explicit source refresh. The former original, proposed correction and earlier report remain retained.

Allocations that depend on changed financial evidence become stale until the operator resolves them. Corrections whose original source is no longer selected remain visible as stale rather than silently attaching to another row. Retire only the obsolete working correction when the corrected original now supplies the desired value.

Findings support investigation, accepted exception or resolution with a retained owner and reason. An accepted exception documents a remaining difference. Marking a finding resolved does not manufacture agreement; the actual source or correction must support the new financial result. An unchanged finding stays tied to its relevant original source and mapping, so changing an unrelated cashier file does not erase the retained disposition of an unchanged permit denial.

## 4. Review and close the exact financial edition

Review all unaccepted findings and the full daily balance. Attach the actual deposit documentation available for that close.

The workspace requires at least two distinct reviewer identifiers, with names, roles, statements and reasons. These are recorded operator attestations; this local workspace does not verify an employer’s staff roster. Each signature binds the exact financial edit revision and snapshot hash.

A later source, allocation, correction, setting or finding-disposition change creates a new financial edition. Earlier signatures remain in history and cannot authorize the changed edition. The interface shows whether each retained signature is current. Closing requires the current signatures and the native acceptance conditions.

A close preserves the selected original sources, financial snapshot, reviewer records and deposit references. Reopening or refreshing a run retains the prior closing and immutable editions. Packet preparation and later receiving observations add history without rewriting the financial edition the reviewers signed.

## 5. Prepare the supplied interface layout and record actual receiving evidence

Create a versioned receiving profile from the actual agreed exchange layout. Choose its source family, output headers, canonical fields, formatting, delimiter, line endings and header policy. An example layout must remain labeled as an example. No built-in layout claims to be the deployed Munis ERMA interface.

Preparing an exchange retains its exact CSV bytes and SHA-256, profile version, financial edition and source run. The result is **prepared**.

After an actual transmission or receiving event, retain its original document and record the observed time, reference and status against the exact prepared exchange. The interface retains the individual receipt records and their source hashes. A historical exchange continues to name the financial edition it was prepared from, even if the current run has advanced.

A local file parser can establish only a local readback. A City, vendor or accounting-system acceptance or posting must come from that actual system’s original evidence. The application does not call those external systems or infer their statuses.

## 6. Deliver, inspect history and continue

Prepare a financial handoff when the intended edition is ready. The packet includes:

- A printable grayscale report and complete exact machine-readable run.
- Human-readable CSVs for transactions, allocations, findings, balances, totals, corrections, signatures, closings and interface exports.
- Original selected files and their mapping/coverage metadata.
- Retained deposit and receiving documents associated with the run.
- All curated original application and financial operator source files, plus per-member hashes.

The human-readable CSVs protect cells that a spreadsheet might interpret as formulas or alter as long numeric identifiers. Original input files and exact JSON are preserved separately.

Use immutable-edition inspection to answer which source file, mapping, correction, allocation and signature produced an earlier result. Use the original full SQLite backup for a working-state handoff or fresh receiving installation. Browser request recovery uses the original request ID and saved outcome; it does not automatically replay an uncertain write.

### Current prepared example

The engineering workflow uses clearly labeled local records to exercise partial payment allocation, refunds, voids, a declined request, two currencies, an exact identifier larger than JavaScript’s integer range, a corrected original, supervisor close and a real local CSV readback. It does not contain City financial data or establish an external receiving result. The native result and subsequent browser continuation identify their actual retained database and completed steps.
