# Complete GridFabric functional input files

This delivery contains the exact 42 files emitted by the published functional-input generator. The eight fictional devices cover 31 days of power, energy and status measurements: 71,424 original records and 96 explicit corrections. Complete expected reports, per-row lineage, authored callback bindings and separately identified public management/query examples are included.

The data is authored for the application’s reproducible operating workflow. It does not represent measured telemetry, provider acceptance or licensed vendor event payloads. Read the source-level [functional guide](../../operations/scf-gridfabric-plaid-receiving-20261012/FUNCTIONAL_INPUTS.md) for the declared formula, correction windows, bindings and original application actions.

## Exact archive

| Item | Value |
| --- | --- |
| Source commit | `c630ecdae098a0a021f96a3e1896feaac805cfbd` |
| Reassembled filename | `GridFabric_Functional_Inputs_c630ecda.zip` |
| Archive bytes | 28355417 |
| Archive SHA-256 | `baac800e3200726289b3794772889591eddb5250834c1f8c2d8e8ec9968036db` |
| Regular members | 42 |
| Member bytes | 28349417 |
| Format | ZIP with stored entries; the four parts are ordinary binary byte ranges |

`GridFabric_Functional_Inputs_c630ecda.parts.json` records every part’s order, offset, length, SHA-256 and Git blob, and every complete member’s name, length and SHA-256. Parts are cut from the same already-verified archive. Concatenation reconstructs that archive exactly.

## Reconstruct and verify

Obtain all four `.zip.part01` through `.zip.part04` files and the parts manifest from this same directory at one published commit. Use the original binary Git files. The following Python standard-library command verifies every part, atomically creates the archive in a chosen output directory, then verifies all 42 member bytes. An existing archive is accepted only when it has the exact expected identity.

```bash
python3 - /absolute/source/deliveries/gridfabric-plaid/GridFabric_Functional_Inputs_c630ecda.parts.json /absolute/private/gridfabric-files <<'PY'
import hashlib, json, os, stat, sys, tempfile, zipfile
from pathlib import Path

manifest_path = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
assert manifest['schema'] == 'stellar-forge.gridfabric-functional-archive-parts.v1'
destination.mkdir(parents=True, exist_ok=True)
archive = destination / manifest['archive']['filename']
def file_identity(path):
    h, n = hashlib.sha256(), 0
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block); n += len(block)
    return n, h.hexdigest()
expected = (manifest['archive']['bytes'], manifest['archive']['sha256'])
if archive.exists():
    assert not archive.is_symlink() and archive.is_file(), 'Archive must be a regular file'
    assert file_identity(archive) == expected, 'Existing archive differs'
else:
    fd, temporary = tempfile.mkstemp(prefix='.gridfabric-archive-', dir=destination)
    try:
        whole, total = hashlib.sha256(), 0
        with os.fdopen(fd, 'wb') as output:
            for index, part in enumerate(manifest['parts'], 1):
                assert part['index'] == index and part['offset'] == total
                assert Path(part['filename']).name == part['filename']
                path = manifest_path.parent / part['filename']
                assert path.is_file() and not path.is_symlink(), 'Part must be a regular file'
                count, digest = 0, hashlib.sha256()
                with path.open('rb') as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        count += len(block); digest.update(block)
                        whole.update(block); output.write(block)
                assert (count, digest.hexdigest()) == (part['bytes'], part['sha256']), 'Part differs'
                total += count
            assert (total, whole.hexdigest()) == expected, 'Complete archive differs'
            output.flush(); os.fsync(output.fileno())
        # A same-filesystem hard link installs the completed bytes without replacing a peer file.
        os.link(temporary, archive)
    finally:
        Path(temporary).unlink(missing_ok=True)
members = {item['path']: item for item in manifest['members']}
with zipfile.ZipFile(archive) as opened:
    entries = opened.infolist()
    assert len(entries) == len(members) == manifest['archive']['member_count']
    assert len({entry.filename for entry in entries}) == len(entries), 'Duplicate member'
    assert {entry.filename for entry in entries} == set(members), 'Member set differs'
    for entry in entries:
        name, item = entry.filename, members[entry.filename]
        assert not entry.is_dir() and not name.startswith('/') and '..' not in Path(name).parts
        mode = entry.external_attr >> 16
        assert not stat.S_ISLNK(mode), 'Symlink member rejected'
        data = opened.read(entry)
        assert (len(data), hashlib.sha256(data).hexdigest()) == (item['bytes'], item['sha256']), name
print(json.dumps({'archive': str(archive), 'bytes': expected[0], 'sha256': expected[1],
                  'verified_members': len(members)}, sort_keys=True))
PY
```

After this verification, extract the archive into a private input directory using the normal ZIP reader. `gridfabric-functional-input.json` is the receiving envelope; its relative paths refer to the included files. The published generator can also produce these same files directly, and its immutable manifest verifies each generated member.

## Original receiving workflow

The generated envelope contains 51 original application steps, 53 exact checks and seven complete output comparisons. It covers original source import, four before-correction report windows, sparse corrections, reviewed mapping activation, three full-range reports, all 16 documented callback routes, duplicate/revision handling, opt decisions, device intent planning, and management request preparation.

Use the original `operations/scf-gridfabric-plaid-receiving-20261012/run-receiving.mjs` entrypoint and its maintained configuration guide. The native receiver binds these files to the same application’s returned source, mapping and request IDs, then exports and reopens its saved workspace. The input archive contains no dispatch instruction, provider credentials or generated provider receipt.

Keep the complete original sources and sparse correction source together. Do not replace an original source with corrected rows or shorten the full-range expected responses. A corrected mapping gives the correction source precedence only for the four device channels actually represented in that source.
