# Water reconciliation — complete source and receiving package

This package contains the complete maintained discovery engine, exact water reconciliation, offline case inspector, original guides and demonstration files, and the original native/browser receiving course. It is generic engineering software. No Kechi, M.E. Simpson or other customer records, credentials, commercial terms or field findings are included.

## Exact source selection

- Archive: `Water_Source.zip`
- Archive bytes: **101619**
- Archive SHA256: **f0161f860e6db5a10f2c3eec1596dde0e95fc562531cc2c0629b824617bf420b**
- Complete member manifest: `SOURCE_SELECTION.json`
- Manifest bytes: **8445**
- Manifest SHA256: **0e775ec1a7ff8ab452110616f4b590a7689072827708a40cf39f87baf68e2d81**
- Product files: **32**, plus the unchanged repository MIT `LICENSE`: **33 ZIP members**.
- Uncompressed source/license bytes: **349321**.
- The eleven original discovery-engine files remain byte-exact. Full owner instructions remain in `WATER_RECONCILIATION.md`; `OPERATOR_GUIDE.md` is the unchanged original engine guide.

Every member was independently decompressed and checked against CRC32, path, Unix mode, bytes and SHA256 during source packaging. This is **SOURCE_PACKAGED**. Native calculations, browser operation, screenshot viewing and complete export reopening are separate receiving results.

## Open the complete original source

Download all four files from this directory into the same authorized local directory: the ZIP, member manifest, this README and `source-package.json`. Use a new source directory. The following standard-library extraction verifies the exact package and every member before materialization; it has no network or installation step.

```bash
python - /absolute/Water_Source.zip /absolute/SOURCE_SELECTION.json /absolute/new-water-source <<'PY'
import hashlib, json, pathlib, stat, sys, zipfile
archive, manifest_path, output = map(pathlib.Path, sys.argv[1:])
sha = lambda data: hashlib.sha256(data).hexdigest()
raw, manifest_raw = archive.read_bytes(), manifest_path.read_bytes()
assert len(raw) == 101619 and sha(raw) == "f0161f860e6db5a10f2c3eec1596dde0e95fc562531cc2c0629b824617bf420b", "Archive identity"
assert len(manifest_raw) == 8445 and sha(manifest_raw) == "0e775ec1a7ff8ab452110616f4b590a7689072827708a40cf39f87baf68e2d81", "Manifest identity"
manifest = json.loads(manifest_raw)
assert manifest["schema"] == "tjlabs.water-reconciliation.complete-source-selection.v1"
assert not output.exists(), "Choose a new source directory; preserve earlier receiving"
expected = {item["path"]: item for item in manifest["files"]}
assert len(expected) == len(manifest["files"]) == 33
with zipfile.ZipFile(archive) as z:
    assert len(z.infolist()) == len(expected)
    assert set(z.namelist()) == set(expected)
    material = []
    for info in z.infolist():
        name = pathlib.PurePosixPath(info.filename)
        assert not name.is_absolute() and ".." not in name.parts and "\\" not in info.filename
        item = expected[info.filename]
        assert stat.S_ISREG(info.external_attr >> 16)
        assert (info.external_attr >> 16) == int(item["mode"], 8)
        body = z.read(info)  # Also verifies original CRC.
        assert len(body) == item["bytes"] and sha(body) == item["sha256"], info.filename
        material.append((name, body))
output.mkdir(parents=True)
for name, body in material:
    target = output.joinpath(*name.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(body)
print(json.dumps({"status":"SOURCE_VERIFIED", "directory":str(output.resolve()), "files":len(material)}))
PY
```

The complete source includes `water_reconciliation.py`, `water_report.py`, `discovery_engine.py` and both receiving helpers. No patch application, JSON-bank reconstruction or stale earlier source package is required.

## Run the maintained native water course

Use Python 3.11 or later with the actual IANA timezone data used by the selected case (the included demonstration selects America/Chicago). The application uses the Python standard library. Run from the verified source directory:

```bash
python receiving_water.py --directory /absolute/new-water-receiving
```

This one maintained course runs the full invented examples A and B, retains the original missing-interval and uninterpreted-credit outcomes, compares source editions, saves the complete handover ZIP, receives it through the original engine, and reruns the received original software from its exact CSV snapshots. It writes `receiving.json`, original `a/` and `b/` cases, `Water_Case.zip`, `received/` and the native `cold/` case.

These are **DEMONSTRATION** inputs explicitly authored for the software course, not customer evidence. For authorized real records use the complete mapping/interpretation instructions in `WATER_RECONCILIATION.md` and `WATER_SELECTION_API.json`, keeping actual source/field/tariff approvals explicit.

The native helper requires a new output directory. Preserve a partial original directory and its actual outputs if it is interrupted; the original receiving owner decides its continuation. Coordinate one receiving owner and process, not parallel duplicate cases.

## Operate and view the actual offline report

Open the actual `a/water/report.html`, `b/water/report.html` and `cold/water/report.html` from that completed course. The report embeds every original calculated result, the complete source report and canonical manifest. Original source CSV bytes remain in each case's `inputs/` directory. Relative links preserve that layout; a separately downloaded HTML keeps the complete calculation/provenance and can read a manually chosen, exactly verified original CSV.

The inspector supports:

- Complete period/account/issue selection and separate register, AMI, independently recorded and billed quantities.
- Exact rational values, saved tolerance decisions, two-period comparisons, every reviewed tariff line and explicit uncomputed states.
- Daily/night/continuous-use outputs with actual local-day hours and complete original source references.
- Full source definitions/profiles, byte/SHA-verified CSV record drilldown and direct retained-source links.
- Complete offline HTML and embedded JSON downloads, explicitly filtered presentation CSV, keyboard navigation and narrow layouts.

Use the original installed browser route when available. The adjacent helper has no dependency install and creates no new data/calculation:

```bash
/actual/node receiving_water_browser.mjs \
  --receiving /absolute/new-water-receiving/receiving.json \
  --output /absolute/new-water-browser \
  --playwright /actual/installed/playwright/index.mjs \
  --chromium /actual/installed/chromium
```

The chosen installed Node module must export `chromium`. An existing Python Playwright installation's actual `driver/package/index.mjs` can be used when present and importable. Use the real installed paths; no path is assumed from a prior host. Keep browser outputs outside the immutable `a/`, `b/` and `cold/` case directories.

The helper operates all five views, actual source-file verification, filters, keyboard controls, desktop and 390px layouts, downloads, cold HTML reopening, and the original later/native-cold reports. It prints the current view to PDF and saves screenshots, complete exports and an atomic `browser-receiving.json`. Add `--resume` with the exact same input/source/runtime selection to continue its retained output; original incomplete attempts remain available.

**Actually open and VIEW every saved PNG and every page of the current-view PDF, then open the complete downloaded HTML/JSON/CSV.** Follow `VIEWING.md` from the producing attempt. Functional `BROWSER_COURSE_COMPLETE` is not a claim that those pixels/pages have been viewed; that field stays pending until the same receiving owner records the actual inspection. Preserve user tabs and current owner browser instructions.

## Preserve the whole handover

For real authorized inputs, the maintained commands are:

```bash
python water_reconciliation.py run \
  --manifest /absolute/manifest.json \
  --selection /absolute/water-selection.json \
  --input-root /absolute/authorized-csv-root \
  --output /absolute/new-complete-water-case
python water_reconciliation.py pack \
  --run /absolute/new-complete-water-case \
  --output /absolute/new-Water_Case.zip
python water_reconciliation.py receive \
  --archive /absolute/new-Water_Case.zip \
  --output /absolute/new-received-water-case
```

Keep the exact selected calculator and renderer source when packing; the native result binds both byte hashes. The complete case ZIP carries original CSV snapshots, manifests, full report, water outputs, original engine and operating source. SQLite is rebuilt by the original engine from the exact saved snapshots. An inspection HTML or filtered CSV does not replace that complete handover.

## Attribution and relationship controls

TokenJunkieLabs (TJLabs) attribution remains in the inspector and all derived report copies. The original MIT LICENSE is included unchanged. Generic source publication does not authorize a customer send, personal signature, confidentiality agreement, native account mutation or new field conclusion. Retain the original prospect, source and receiving owners; any message after positive human contact needs Bryce's exact text/attachment green, and contracts/confidentiality agreements require his reading and personal signature. Ordinary already-authorized account setup/ToS are separate.

## Existing completed native course: loopback browser continuation

The original PR4741 ZIP and its exact hashes above remain the frozen source of an already completed native operation. If its browser stopped at a managed file:// navigation restriction, use the complete reviewed successor `receiving_water_browser.mjs` in this receiving directory and follow `WATER_LOOPBACK_RECEIVING.md`. `BROWSER_CONTINUATION.json` binds the original and successor helper identities. Do not rerun the native calculation or overwrite its source archive. The full successor serves the same exact files through an allowlisted, read-only 127.0.0.1 application route and closes that route when the original helper exits.

For that exact predecessor only, preserve the original receiving path, browser output directory and installed runtime paths and add `--resume --adopt-loopback`. This retains browser-input.json and every failed attempt, while a separate immutable helper adoption records the actual selected successor. New browser outputs can use the successor without adoption flags. Actual screenshot/PDF/export viewing remains required after functional completion.

## Actual rendered-output correction

The original equipped receiver completed the native and browser course and personally viewed its11 PNGs and3 PDF pages. The retained output exposed badge contrast, narrow table readability and print-flow defects. Their correction is a separate source-bound presentation of the same native results; the original Water_Source.zip, case archive, native receipt and completed browser attempts remain intact.

Read [visual-correction/WATER_VISUAL_RECEIVING.md](visual-correction/WATER_VISUAL_RECEIVING.md). That complete four-file continuation generates new HTML in a separate directory, binds the exact original native receiving/result/report/manifest/CSV and selected renderer identities, and operates those presentations through the original scoped loopback browser receiver using explicit --inspection. It adds no new water calculation. The producing owner must operate and personally view the corrected screenshots, all PDF pages and reopened exports before visual completion is reported.
