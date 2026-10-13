# Apply the integrated operator source

The receiver installs a complete source bundle into an existing Upper Savannah application. It composes all file postimages before replacing application files, keeps the exact originals, and resumes the same operation after interruption. It uses Python 3.9 or later and the standard library.

## Run it

Save the supplied receiver as operator/integrate_operations.py and the plain JSON bundle as an explicit file. The application root is the directory containing the original operator/ and model/ directories.

    python operator/integrate_operations.py operations.json --application /path/to/upstate_forever_2026 --dry-run
    python operator/integrate_operations.py operations.json --application /path/to/upstate_forever_2026

The first command reports the complete plan without creating directories, a lock, a journal, or temporary files. The second applies the operation immediately. Dry run is an inspection option; the receiver has no review or approval step.

Use the same command, JSON bundle, application directory, and operation_id to resume an interrupted installation. The journal reconciles exact current file bytes before it continues.

## Choose the installed registration route

The current source release defaults to the shared extension registry. Its top-level `files` carries the complete source preparation, run desk and operating guides; its top-level `edits` is empty. Apply that bundle to the assembled application using this receiver, then install the current ECSA extension package into the same application:

    /opt/pyvenv/bin/python -B operator/integrate_operations.py operations.json --application /mnt/data/eco12-integrated-20261012
    /opt/pyvenv/bin/python -B RECEIVED_EXTENSION_ROOT/install_extensions.py --application /mnt/data/eco12-integrated-20261012 --source-root RECEIVED_EXTENSION_ROOT

Use the actual received paths on other hosts. The ECSA descriptors `operator/extensions/source-preparation.json` and `operator/extensions/native-run-desk.json` register the source actions, authenticated reads, assets and screen lifecycles. Their extension host forwards the original queue, workspace, delivery and programme capabilities.

The release also retains the earlier exact direct registration edits in `direct_registration`. This alternate route is for an application using direct registrations instead of the extension registry. Create a separate direct bundle with its supplied distinct operation ID, paths and edits; remove `direct_registration` from that derived bundle before applying it. The main receiver ignores this descriptive alternate-route field.

    import json
    from pathlib import Path
    packet = json.loads(Path("operations.json").read_text(encoding="utf-8"))
    direct = packet.pop("direct_registration")
    packet.update(direct)
    Path("operations-direct.json").write_text(
        json.dumps(packet, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")

One mechanism owns the source actions and each desk instance. Applying the direct action and browser joins as well as the registry descriptors creates duplicate registrations. Where a receiver already has direct registrations, reconcile that actual shared source into its selected integration route before installing descriptors.

The original helper source and data editions remain separate installed inputs. Adopt the current compatible native helpers and the source-input packet identified by the release. The existing regional raster and workspace implementations remain owned by their integration authors.

## Bundle contract

The required schema is upstate.operator-integration/v1. All paths are relative to the explicit application root, use forward slashes, and must occur in allowed_paths.

    {
      "schema": "upstate.operator-integration/v1",
      "operation_id": "UPSTATE-OPERATIONS-20261012-R1",
      "allowed_paths": [
        "operator/web/run_workbench.mjs",
        "operator/web/app.mjs"
      ],
      "files": {
        "operator/web/run_workbench.mjs": {
          "content": "complete source text",
          "bytes": 20,
          "sha256": "lowercase SHA-256 of those exact UTF-8 bytes"
        }
      },
      "edits": [
        {
          "path": "operator/web/app.mjs",
          "id": "import-run-desk",
          "before": "the complete unique original anchor",
          "after": "the complete replacement anchor"
        }
      ]
    }

This is a shape example; a deliverable bundle must carry the real byte length and 64-character lowercase digest for each complete file. JSON string escaping does not change the decoded source bytes. The receiver preserves UTF-8 content, line endings, and a source BOM exactly as supplied. It does not normalize whitespace or HTML entities.

Fields:

| Field | Meaning |
| --- | --- |
| schema | Exact version string upstate.operator-integration/v1. |
| operation_id | Stable 1-120 character operation name, starting with a letter or digit; remaining characters are letters, digits, dots, underscores or hyphens. |
| allowed_paths | Required explicit list of permitted source targets. Every file and edit path must be present. |
| files | Optional object of complete UTF-8 file entries keyed by exact relative path. |
| files[path].content | Entire source text, not a diff or excerpt. |
| files[path].bytes | Integer count of the encoded UTF-8 bytes. |
| files[path].sha256 | Lowercase SHA-256 of those exact UTF-8 bytes. |
| files[path].expected_previous_sha256 | Optional hash permitting replacement of an existing different complete file. |
| edits | Optional array of exact string replacements; order within each file is preserved. |
| edits[].path | Declared source target. |
| edits[].id | Globally unique nonempty edit identifier. |
| edits[].before | Nonempty exact original anchor. |
| edits[].after | Exact replacement text; an empty string removes the anchor. |

Additional top-level metadata such as title, dependencies, compatible_source, source_reference and notes is retained in the operation identity. It is descriptive: the receiver applies files and edits, and does not enforce an older dependency digest against a compatible newer implementation.

At least one complete file or edit is required. Duplicate JSON keys, non-finite numbers, duplicate edit IDs, invalid UTF-8, aliases, absolute paths, dot segments, backslashes, control characters, reserved names, and target paths that are also another target's parent are rejected before source replacement. Existing symlinks and nonregular files are preserved.

## Composition and concurrent source

An absent complete file can be created. An identical retained file is reused. A different existing complete file is replaced only when its digest equals expected_previous_sha256. Without that guard the receiver reports the differing path and preserves it.

Edits apply to the current complete source, preserving unrelated text. For each edit, a unique complete after anchor is recognized first when no before anchor extends outside it, including insertions whose after text contains the original before anchor. Otherwise one unique before anchor is replaced when the after anchor is absent, or when its single complete occurrence is wholly contained inside that before anchor. This permits an exact contraction, such as removing a condition while retaining its body, and recognizes the result on retry. Duplicate anchors, outside matches and matches extending across the original boundary remain conflicts with the exact edit ID. Multiple edits on the same file are composed in their listed order.

A complete file and edits may target the same path. Those edits compose on the supplied complete content; the final postimage or the supplied unedited content may already be retained. Updating any other existing complete content still requires expected_previous_sha256.

All target snapshots and postimages are assembled before application source is replaced. The receiver serializes its own invocations, checks every current target against the recorded preimage or postimage before applying, and checks the target again immediately before each replacement. POSIX directory descriptors confine parent traversal; other supported platforms check path components and use replacements in the same directory.

Atomicity is per file. Other editors can change files while the receiver is running, so the receiver uses byte guards and reports divergence instead of performing a destructive rollback. A later concurrent edit remains in place. Existing file permissions are preserved, including a permission-only change observed immediately before replacement.

## Journal and interruption recovery

Operation state is retained under:

    APPLICATION/.operator-integration/OPERATION_ID/
      intent.json
      journal.json
      objects/SHA256

The intent binds the operation ID to the canonical JSON bundle digest and the resolved application directory. Do not reuse an operation ID for a different bundle. Formatting the same JSON differently preserves its identity; changing content or metadata changes it.

Every original and intended file is stored as an immutable object named by its SHA-256. The journal records the path, original existence/hash/byte length/permissions, intended hash/length/permissions, applied status and edit IDs. A journal is marked prepared only after all objects are retained. All control records use atomic replacement.

After interruption:

1. A target equal to the intended postimage is recognized as applied, including a crash between file replacement and journal update.
2. A target equal to its recorded preimage remains pending and is applied.
3. A target with different current bytes is preserved and identified precisely.
4. An interrupted preparation before journal creation is safely recomposed from current source. Content-addressed backup objects remain immutable.

For a genuine source conflict, compose a new bundle against the current file and give it a new operation ID. This preserves the earlier operation history and allows the revised joins or explicit previous digest to express the intended update.

A completed journal is historical. Repeating the same operation verifies current postimages; it never reinstalls over source edited after completion. Later differences produce complete_with_later_changes and the affected paths. Exact originals remain accessible through the journal's before.sha256 object references.

A deletion edit with an empty after string can be resumed safely through its journal. Without a retained journal, absence of the before text cannot prove which deletion occurred; supply a fresh anchor against the current source.

## Output

The command prints one JSON result using schema upstate.operator-integration-result/v1. Results identify the operation, canonical bundle digest, resolved application path, current state, dry_run/resumed flags, per-path before/after/current hashes, edit outcomes, counts, and journal path.

Exit codes are 0 for a ready dry run or a completed matching operation, 2 for invalid input or retained state, 3 for source conflicts or an active receiver, 1 for filesystem errors, and 130 for an interrupt. A partial operation retains enough state for the same command to continue.

## Recovering the supplied source Canvas

The receiver accepts an ordinary JSON file. When its source packet is carried by Slack Canvas, first decode the Slack tool's outer JSON response and read markdown_content. The Canvas carrier can transform indentation spaces to U+00A0 nonbreaking spaces. The published packet contains no intentional nonbreaking spaces: normalize U+00A0 to an ordinary space before extracting and decoding the JSON code block.

Do not HTML-decode source strings. Then verify every decoded file against its supplied UTF-8 byte length and SHA-256 before saving. The integrated application release uses gzip plus base64 chunks to preserve its source bytes. Join chunks in part order, decode base64, decompress gzip, and verify the printed decoded byte count and SHA-256 before reading the resulting ordinary JSON. The receiver itself validates each complete file's decoded bytes.
