# Receive complete source banks into the existing application

Use `source_bank_receive.mjs` to compose explicitly selected source changes into a **fresh copy of the original application**. The receiver supports complete `commons.source-bank/v1` JSON and the gzip/Base64 envelope written by `v8_source_carrier_codec.cjs`.

The tool is for an already authorized source update. It preserves the original application and its separate saved Workspace while preparing the concrete receiving edition. Run the existing application's normal launcher from the resulting source directory, using its existing case and Workspace arguments.

## Receiving

Keep these three files together:

- `source_bank_receive.mjs`
- `source_bank_compose.cjs`
- `v8_source_carrier_codec.cjs`

Use the application's required Node version; this receiver uses only standard Node modules.

```sh
node source_bank_receive.mjs \
  --application /absolute/path/to/current/application \
  --bank /absolute/path/to/complete-bank.json \
  --expect EXACT_DECODED_BANK_SHA256 \
  --source-prefix repository/relative/application \
  --operation-id EXISTING_OPERATION_ID \
  --output /absolute/path/to/fresh/application
```

The expected SHA256 binds the entire decoded UTF-8 bank body, including formatting. For a plain JSON file it is that file's SHA256. For an encoded carrier, the complete carrier's gzip and decoded identities are additionally checked by the codec. The source prefix removes the repository directory prefix from member paths; omit it when member paths are already relative to the application.

Supply successive `--bank FILE --expect SHA256` pairs to apply source families in their documented order. The initial application remains the base for the complete source tree. Existing unselected dependency bodies are retained; absent dependencies are supplied from the complete bank. An existing selected file is replaced only at its declared predecessor or composed through its exact guarded edits.

`--plan` performs source-bank, full-body, predecessor and anchor validation and prints the proposed changes without creating an output directory. Omit `--output` in this mode. A normal run performs those checks before claiming the fresh output, copies the original source tree, writes the selected changes, rereads each changed file and prints a JSON receiving result on stdout.

The output directory must be new and outside the original application. It records the composed source edition only. Continue the established application startup, native case operation, export and reopening course. A source stage does not itself run a server or change a provider record.

## Bank contract

```json
{
  "schema": "commons.source-bank/v1",
  "files": [
    {
      "path": "repository/relative/application/module.mjs",
      "content": "<complete UTF-8 source body>",
      "bytes": 123,
      "sha256": "<complete body SHA256>"
    }
  ],
  "composition": {
    "delta_paths": [
      "repository/relative/application/module.mjs"
    ],
    "patches": [
      {
        "path": "repository/relative/application/module.mjs",
        "preimage_sha256": "<original complete body SHA256>",
        "postimage_sha256": "<delivered complete body SHA256>",
        "edits": [
          {"old": "<unique original literal>", "new": "<unique replacement literal>"}
        ]
      }
    ]
  }
}
```

Every file has a complete body and exact byte/SHA identity. Every patch belongs to a selected delta and its postimage is the corresponding full member. The planner reverses the ordered edits from that full postimage and verifies the predecessor SHA, then applies them forward to reproduce the exact full postimage. Both sides of an edit must be nonempty and distinct. Represent deletions with surrounding unchanged context so each side remains a unique literal.

For an exact predecessor, the full postimage is used. For a concurrently edited source file, unique literal edits are composed while retaining unrelated text. Already applied edits are recognized. A divergent selected file without a valid patch, an ambiguous anchor, a mismatched complete body or an unsafe path stops composition before the fresh output is created.

The `files` collection may also contain retained dependencies outside `delta_paths`. Existing copies of those dependencies remain current; missing files are added. Include only application source in this collection. Original customer records, saved Workspaces, native receipt bodies and other operation inputs belong in their existing separate artifact locations and are opened through the original application's import/receiving flow.

Optional member modes are `100644` or `100755` (also `644`, `755`, or numeric 420/493). Existing source modes take precedence. Source paths must be relative and cannot traverse directories. The native receiver rejects symlinks and special files in the source tree, so use the original application's real source directory. Input banks, encoded carriers and individual copied files are limited to 64 MiB. The receiver verifies that selected source files did not change between planning and copying.

If copying fails after the fresh output is created, the error identifies that incomplete directory. The original application is unchanged. Resolve the concrete cause and use a new output directory; the tool never overwrites a previous receiving edition.

## Reusing the pure planner

`createSourceBankComposer({identity})` returns `validateBank(bank)` and `compose({banks,current,sourcePrefix})`. The identity callback accepts a complete string and returns `{bytes,sha256}`. The current map contains application-relative paths with text values or `{content,mode}` objects. The returned plan includes full changed bodies and the per-layer source decisions. The module performs no I/O and does not evaluate supplied source.

This makes the same composition usable in orchestration environments and the native receiving CLI. Transport identity confirms exact bytes; it does not establish sender authority. Keep private source and private operation inputs in their existing authorized destinations.

## Product operation

Before presenting a resulting app, report or export, the producing worker must run/render the exact outgoing edition and LOOK at the actual populated desktop/screenshare and relevant narrow screens. Operate the important loaded, empty, loading and error controls; download, open and use the outgoing HTML, PDF, CSV, JSON, project and archive attachments in their normal applications; and reopen the saved Workspace. Fix clipped, cramped, unreadable, broken or unstyled output. Preserve the existing plain industrial design and native scientific/business computation.

Source checks, HTTP status, DOM counts, tests, captured-but-unviewed screenshots and another worker's approval do not replace actual product use. Keep this focused on the changed product and its real exports. For any video/audio narration use available natural generative TTS, then play and inspect the final media. The repository's current owner instructions and original task deadlines remain applicable.

## Validation of this edition

The pure planner was executed on a complete existing two-file documentation bank, including its exact original predecessor. A second operation retained an unrelated concurrent source addition, and reopening that composed state produced no changes. The JavaScript receiving source was syntax parsed. Native filesystem staging remains part of the existing receiving worker's real application operation.
