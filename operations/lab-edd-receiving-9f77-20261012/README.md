# Complete Lab EDD native receiving input

This package supplies the complete merged application and retained inputs for `MCCAMPBELL-EDD-RECEIVING-9F77-20261012`. Product commit `7ce6a94d22e5d71fc8fa8ebb5de09083aa67f037` ([PR 2042](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2042)) contains the original laboratory source profiles, sealed-file worker, native workbook and complete browser/process receiving.

## Complete source

The 66 UTF-8 source, configuration and guide files and three original binary members total 69 files and 1,026,880 bytes. Every member's original Git identity was checked at the product commit. The source includes the workbook reader, worker, process broker/guardian, complete input store, current common seller dependencies and original MIT license.

The maintained Commons source reader reconstructed all 66 source files in V8: COMPLETE, 581,881 bytes, zero issues. The actual runtime needs Node 22+, Python 3.10+ and the original RE2JS 2.8.6 dependency. Browser receiving uses an existing Playwright and Chromium installation. The exact dependency archive and whole-operation resource declaration are in `dependencies.json`.

## Receive the source and original binary members

Use the equipped host's existing Commons source receiver:

```sh
node /absolute/commons/host/receive_source_carriers.cjs \
  --input /absolute/package/source.json \
  --manifest /absolute/package/manifest.json \
  --out /absolute/private/lab-source
```

The four maintained receiver identities are in `manifest.json`. Its original guarded receiver reuses matching files in the same selected source directory.

`binary-inputs.json` retains the exact two published supplier ZIPs and the complete original model artifact. It records each original path, byte count, SHA256 and Git blob with its complete canonical base64 bytes. Restore those three members with the standard Python decoder:

```sh
python3 - /absolute/package/binary-inputs.json /absolute/private/lab-source <<'PY'
import base64, hashlib, json, os, pathlib, sys
root = pathlib.Path(sys.argv[2]).resolve(strict=True)
carrier = json.loads(pathlib.Path(sys.argv[1]).read_text())
for row in carrier['files']:
    relative = pathlib.PurePosixPath(row['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('Invalid retained member path')
    target = root.joinpath(*relative.parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.parent.resolve(strict=True).is_relative_to(root):
        raise ValueError('Retained member escapes source directory')
    data = base64.b64decode(row['content'], validate=True)
    if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('Retained binary identity differs')
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file() or target.read_bytes() != data:
            raise ValueError('Reconcile original binary member')
    else:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    print(json.dumps({'path': row['path'], 'bytes': row['bytes'], 'sha256': row['sha256']}))
PY
```

The original supplier files retain their actual acquisition identities:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| Equis3.zip | 9,862 | 9253032d539ced2d60b04f1c3e9188dc55c8a2c0ce873c2e8cd4273f28db203d |
| Equis4_CSV.zip | 10,432 | a57c18f4bf8054503155e1c8ccdb0bf7b736e4cc5eefef5e8d4c61a145ed2879 |
| McCampbell_Complete_EDD_Model_20261012.zip | 424,705 | 1cd63aab060efd7fc6bcea03136133df9bcf3669715ad02bfb8a201364918c27 |

## Continue the same whole application operation

The executable files below are under `stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/` in the received source.

1. Run `python3 workbook-native-receiving.py /absolute/private/lab-source` for the complete generated XLSX format exercise.
2. Run the same helper with `/absolute/private/lab-source --fixture-only /absolute/private/DTS8D-native-format.xlsx`. It retains the same original 150-header workbook for the sealed worker.
3. Copy `receiving.complete.example.json` into the private operation. Set its merchant and both original source ZIPs to their received absolute paths; select the generated fixture for the DTS family. Enter the existing Playwright module, Chromium executable, actual launch arguments and private browser temporary directory. Retain the original operation name, profiles, input hashes and `processOwnership`.
4. Run the original receiver:

```sh
node --expose-gc --max-old-space-size=512 \
  /absolute/private/lab-source/stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/receiving.mjs \
  --configuration /absolute/private/receiving.json \
  --directory /absolute/private/lab-receiving-01 \
  --scratch /absolute/private/lab-worker-temp
```

The existing resource controller can sequence `--phase native` and `--phase browser` for the same retained operation. Set `LAB_EDD_PYTHON` to the selected absolute interpreter. Reuse the host's actual Chromium library environment and root-container flags when applicable. The full `lab-edd/RECEIVING.md` explains every input and retained output.

The operation runs all three complete families through initial review, explicit decisions, full editable tables, sealed-file jobs, complete native output comparisons and same-job replay. Its process phase observes the actual Python decode before cancellation/deadline and checks the original process retirement and scratch cleanup. The browser opens those same reports, downloads every visible artifact, edits/reopens decisions and retains desktop/mobile viewports.

## Return the completed delivery

Return the shareable `result.json`, complete reviewed result ZIPs, workbook exercise output, process receiving outcomes and selected screenshots to the [original receiving thread](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791794165385169). Keep the private `receiving.json` file-store token checkpoint with the same executor.

The source acquisition and complete two-family Node model run finished at 09:23–09:36 UTC on October 12. This package retains that completed result and supplies its original workbook/worker/browser continuation. The accepting executor records the actual host and completed phase/file identities in the same operation.
