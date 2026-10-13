# Regional Watersheds: complete observed-evidence continuation

Operation: `ECO-SCI-ROOT-WATERSHED-EVIDENCE-EXPORT-20261013`.
The gzip contains the exact 26 UTF-8 source files from merged application edition
`6f098daf08003a13671c04ff6d1bdc45535c158d`: the complete 11-file workflow/install/presentation
continuation and the original 15-file data edition (manifest plus 14 physical
source members). It includes merged PRs 3725, 3743 and 3777.

This branch is a compact transport snapshot. Its tree contains only this source
bank, its inventory, and these receiving instructions. The source changes are
already merged into the application through the PRs above.

## Materialize into a new prepared directory

Use the actual downloaded carrier and a new owned output directory as the two
arguments. The following standard-library command validates the complete bank
before creating the prepared directory.

```sh
python -B - ACTUAL_DOWNLOADED_GZIP NEW_PREPARED_SOURCE_DIRECTORY <<'PY'
import gzip, hashlib, json, pathlib, sys
blob = pathlib.Path(sys.argv[1]).read_bytes()
if len(blob) != 998732 or hashlib.sha256(blob).hexdigest() != "b44aeafc1acb69b601c93549b19a557fbb722ada7479cd05e7c03a395850bb23":
    raise ValueError("The downloaded gzip differs from the published edition")
decoded = gzip.decompress(blob)
if len(decoded) != 6223142 or hashlib.sha256(decoded).hexdigest() != "362650dbfc930e30960c370e84e31522ec800507e6ef0a65013f09ab988afe7d":
    raise ValueError("The decoded source bank differs from the published edition")
bank = json.loads(decoded)
if bank.get("schema") != "commons.source-bank/v1" or bank.get("operation") != "ECO-SCI-ROOT-WATERSHED-EVIDENCE-EXPORT-20261013":
    raise ValueError("Choose this watershed source bank")
members = bank["files"]
if len(members) != 26:
    raise ValueError("Expected the complete 26-member source bank")
checked = {}
for entry in members:
    name = entry["path"]
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or str(path) != name or any(part in ("", ".", "..") for part in path.parts) or "\\" in name:
        raise ValueError("Invalid source member path")
    if name in checked:
        raise ValueError("Duplicate source member")
    body = entry["content"].encode("utf-8")
    if len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]:
        raise ValueError("Source member differs: " + name)
    checked[name] = body
if sum(map(len, checked.values())) != 5942344:
    raise ValueError("The source bank total differs")
destination = pathlib.Path(sys.argv[2]).absolute()
destination.mkdir(parents=True, exist_ok=False)
for name, body in checked.items():
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
print(json.dumps({"prepared_source": str(destination), "files": len(checked),
                  "bytes": sum(map(len, checked.values())),
                  "source_ref": bank["source_ref"]}, indent=2))
PY
```

## Install into the existing source application

Use the existing prepared installer's transactional path. It combines updated
members with unchanged installed members, validates all original data companions,
and keeps its rollback data under the actual application's
`.watershed-context-installs` directory.

```sh
python -B NEW_PREPARED_SOURCE_DIRECTORY/operator/install_watershed_context.py \
  --application ACTUAL_EXISTING_APPLICATION \
  --source-root NEW_PREPARED_SOURCE_DIRECTORY
```

## Continue the same original Workspace receiving journey

The existing driver operates the actual extension, exports an observed-evidence
selection, downloads its files, transfers the Workspace, reopens the saved result,
and compares every retained file. Pass the actual original source manifest and
source directory from the same retained application.

```sh
python -B ACTUAL_EXISTING_APPLICATION/integration/run_watershed_context_operator.py \
  --application ACTUAL_EXISTING_APPLICATION \
  --workspace ACTUAL_ORIGINAL_WORKSPACE \
  --source-dir ACTUAL_ORIGINAL_WATER_CONTEXT_SOURCE_DIRECTORY \
  --source-manifest ACTUAL_ORIGINAL_WATER_CONTEXT_MANIFEST \
  --include-observed-evidence \
  --output NEW_OWNED_JOURNEY_OUTPUT
```

Inspect the populated Regional Watersheds screen at a normal and narrow width.
Operate the observed-evidence checkbox, open the completed selection, and inspect
the exact outgoing HTML/PDF. The complete instructions live in the prepared
`operator/WATERSHED_CONTEXT.md` and
`integration/WATERSHED_CONTEXT_RECEIVING.md`.

The original selected and contributing-union evidence, all eight land-cover
groups, dated station context, and original source files travel together with
the saved export. Existing original Workspace identity is preserved.
