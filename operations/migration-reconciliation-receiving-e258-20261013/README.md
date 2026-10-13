# Migration reconciliation — complete source and receiving package

This ordinary source ZIP contains the maintained discovery engine, full migration calculator, read-only localhost inspector, both original receiving helpers, complete operating/API guides, three whole invented editions, and the unchanged MIT LICENSE. It is generic software. No Sagacity or other customer records, credentials, proposals or private counterpart terms are included.

## Exact complete source

- Archive: **Migration_Source.zip**, 145615 bytes, SHA256 **afa9478ed1ee9ea071890dc21cf6c826ec466d24e4684b4fc658822f88053ec7**.
- Member manifest: **SOURCE_SELECTION.json**, 24307 bytes, SHA256 **b1c6ec53f39ff2e91c6dec0748c766a918cc4b07c6122c679c24f8a20f16080a**.
- **96 complete product files**, including the original LICENSE; 586911 uncompressed bytes.
- All eleven original discovery-engine files remain byte-exact.
- The full owner instruction and exact inspector operator section are in MIGRATION_RECONCILIATION.md. The original README.md and OPERATOR_GUIDE.md remain unchanged.

Every ZIP member was independently decompressed and verified against CRC32, path, Unix mode, bytes and SHA256. This is SOURCE_PACKAGED; it is not an assertion that native calculations, browser operation or actual image/page viewing have finished.

## Open and verify the complete package

Keep this README, Migration_Source.zip, SOURCE_SELECTION.json and source-package.json together. Select a new source directory. This standard-library extraction checks the complete archive and every declared member before writing:

```bash
python - /absolute/Migration_Source.zip /absolute/SOURCE_SELECTION.json /absolute/new-migration-source <<'PY'
import hashlib, json, pathlib, stat, sys, zipfile
archive, manifest_path, output = map(pathlib.Path, sys.argv[1:])
sha = lambda data: hashlib.sha256(data).hexdigest()
raw, manifest_raw = archive.read_bytes(), manifest_path.read_bytes()
assert len(raw) == 145615 and sha(raw) == "afa9478ed1ee9ea071890dc21cf6c826ec466d24e4684b4fc658822f88053ec7", "Archive identity"
assert len(manifest_raw) == 24307 and sha(manifest_raw) == "b1c6ec53f39ff2e91c6dec0748c766a918cc4b07c6122c679c24f8a20f16080a", "Manifest identity"
manifest = json.loads(manifest_raw)
assert manifest["schema"] == "tjlabs.migration-reconciliation.complete-source-selection.v1"
assert not output.exists(), "Choose a new source directory"
expected = {item["path"]: item for item in manifest["files"]}
assert len(expected) == len(manifest["files"]) == 96
with zipfile.ZipFile(archive) as z:
    assert len(z.infolist()) == len(expected) and set(z.namelist()) == set(expected)
    material = []
    for info in z.infolist():
        name = pathlib.PurePosixPath(info.filename)
        assert not name.is_absolute() and ".." not in name.parts and "\\" not in info.filename
        item = expected[info.filename]
        assert stat.S_ISREG(info.external_attr >> 16)
        assert (info.external_attr >> 16) == int(item["mode"], 8)
        body = z.read(info)
        assert len(body) == item["bytes"] and sha(body) == item["sha256"], info.filename
        material.append((name, body))
output.mkdir(parents=True)
for name, body in material:
    target = output.joinpath(*name.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(body)
print(json.dumps({"status":"SOURCE_VERIFIED","directory":str(output.resolve()),"files":len(material)}))
PY
```

No JSON-bank reconstruction, patch application, dependency installation or stale earlier source tree is needed. Use the complete selected source directory unchanged during calculation, packing and receiving.

## Run the original three-edition native course

Use an existing Python 3.11+ environment with SQLite. The calculator/server use the standard library. Choose a new private output directory outside the source:

```bash
python /absolute/new-migration-source/receiving_migration.py \
  --directory /absolute/private/migration-receiving \
  --keep-server
```

This one course consumes every authored row in all ten source/target pairs and both crosswalks. A retains missing/invalid rows, duplicate identities, ambiguous mappings and a negative-credit sign error. B corrects source membership/amounts but keeps unresolved identities. C resolves the remaining issues. These are explicitly DEMONSTRATION inputs; the small course is not customer evidence or a two-million-row throughput benchmark.

The course runs the actual original calculator/packer for A/B/C, preserves every earlier archive, compares source editions, receives the complete final archive, reruns its received workbench against exact original snapshots, and verifies all JSONL/CSV/SQLite/source identities. It opens the actual server and reads its complete paged records/totals, original multiline CSV, filtered streams and complete downloads.

Preserve receiving.json, receiving-progress.json, every stdout/stderr, all original cases, independent received/cold cases and every complete archive. A returned native attempt stays intact; the original owner handles its concrete continuation. The native programme requires a new directory and does not overwrite a completed case.

## Operate the actual unresolved and corrected inspectors

With --keep-server, only the final C server remains live. Its actual receipt is recorded in receiving.json and server-current.json. The same browser helper operates this existing process; it creates no server, dataset or calculation:

```bash
/actual/node /absolute/new-migration-source/receiving_migration_browser.mjs \
  --server-receipt /absolute/private/migration-receiving/server-current.json \
  --directory /absolute/private/migration-browser-c \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

Both runtime path arguments are required. Use the receiver's real installed module exporting chromium and actual browser executable. An installed Python Playwright wheel's driver/package/index.mjs is usable if the selected Node can import that module. No install occurs.

The helper reads the actual token-scoped localhost receipt, binds the original source/selection and application identities, operates all five views, filters and source drilldowns, streams complete population/total downloads and the complete ZIP, cold-opens its labelled subset HTML, restores a source-bound view in a cold context, and captures desktop/390-pixel/PDF output. It selects an actual numeric DIFFERENCE before a MATCHED record where available, and opens an actual crosswalk pair. CSV/JSONL full exports are never narrowed to a visible page.

**A must also be opened and operated.** A C-only browser course does not demonstrate the unresolved/difference states or A's more-than-forty-record next-page control. Preserve one coordinated receiving owner and sequence these existing cases; do not start parallel duplicate calculations.

After the owner finishes with and stops its own retained C server, open A with the same original application in a foreground terminal (keep it running while the browser operates):

```bash
python /absolute/new-migration-source/migration_server.py \
  --case /absolute/private/migration-receiving/edition-a \
  --archive /absolute/private/migration-receiving/Migration_Edition_A.zip \
  --receipt /absolute/private/migration-edition-a-server.json \
  --port 0
```

In the coordinated browser terminal:

```bash
/actual/node /absolute/new-migration-source/receiving_migration_browser.mjs \
  --server-receipt /absolute/private/migration-edition-a-server.json \
  --directory /absolute/private/migration-browser-a \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

The same original operator can then stop only that server and reopen the remaining preserved cases using the following exact selections. Use a new private receipt and browser output directory each time; keep the selected source unchanged:

| View | Server application | --case | --archive |
| --- | --- | --- | --- |
| B: source/amount corrections, identities unresolved | /absolute/new-migration-source/migration_server.py | /absolute/private/migration-receiving/edition-b | /absolute/private/migration-receiving/Migration_Edition_B.zip |
| C: corrected original case | /absolute/new-migration-source/migration_server.py | /absolute/private/migration-receiving/edition-c | /absolute/private/migration-receiving/Migration_Edition_C.zip |
| Independently received C | /absolute/private/migration-receiving/received-final/workbench/migration_server.py | /absolute/private/migration-receiving/received-final | /absolute/private/migration-receiving/Migration_Edition_C.zip |
| Rerun from received original CSVs | /absolute/private/migration-receiving/received-final/workbench/migration_server.py | /absolute/private/migration-receiving/cold-rerun | /absolute/private/migration-receiving/Migration_Cold_Original_Source.zip |

Use --receipt /absolute/private/new-case-server.json --port 0 for the selected server, then the same browser helper with that receipt and a distinct --directory. The course does not infer that another case was viewed simply because its source exists. Follow the full opening and correction meanings in MIGRATION_RECEIVING.md and examples/README.md.

Browser interruption resumes the same input/runtime/output directory with --resume. Original incomplete attempts remain; the helper retains an exact input record and atomic lock/progress/completion. A completed course is reused only after full saved artifact hashes match. It never overrides a live/foreign owner.

## Actually view the outgoing rendered files

The receiving owner must open and **VIEW every saved PNG and every page of Migration_Current_View.pdf**, then open the downloaded subset HTML and inspect complete JSONL/CSV/source/case exports. Follow each attempt's VIEWING.md. Confirm unresolved fields and £120 variance in A, mapped source identity, missing/uncomputed states, complete dimension totals, source/target CSV records, readable narrow controls and all current-view/full-export distinctions.

BROWSER_COURSE_COMPLETE records functional browser actions and artifact identities. Actual screenshot/export viewing remains PENDING until the owner has looked at those real outputs. Do not present code review, DOM counts, a captured PNG filename or another worker's review as viewed product completion. Preserve current owner browser instructions and selected user tabs.

## Whole data and reopening semantics

The inspector is read-only. Its HTML contains the application and a small original-case identity, while every record and dimension total lives in the native disk-backed results. Full JSONL/CSV and the entire verified case ZIP stream from the original server. Downloaded current-page HTML/CSV are explicitly limited subsets, not a replacement for the population. View settings contain no server token and only reopen the same original source/interpretation.

For real authorized exports, the generic maintained commands are:

```bash
python migration_reconciliation.py run \
  --manifest /absolute/private/manifest.json \
  --selection /absolute/private/selection.json \
  --input-root /absolute/private/exports \
  --output /absolute/private/new-case
python migration_reconciliation.py pack \
  --run /absolute/private/new-case \
  --output /absolute/private/new-Migration_Case.zip
python migration_reconciliation.py receive \
  --archive /absolute/private/new-Migration_Case.zip \
  --output /absolute/private/new-received-case
```

Keep every source/target/crosswalk export, exact key/type/field/scale/dimension/null/tolerance declaration and data-owner interpretation. No hidden filter, deduplication, fuzzy match, currency conversion, rounding-to-equality or acceptance decision is supplied by the software. A received manifest intentionally uses retained snapshot paths; its rerun identity may differ while complete source hashes and semantic row/total values match.

## Attribution and relationship controls

TokenJunkieLabs (TJLabs) attribution remains in the software and reports. The original MIT LICENSE is inside the source and complete case workbench. Generic source delivery is separate from customer data custody, a customer send or production change. Preserve original prospect/source/receiving owners. Every message after positive human contact needs Bryce's approval for that exact text and attachments; contracts/confidentiality require his reading and personal signature. Ordinary authorized account creation and ToS remain separate.
