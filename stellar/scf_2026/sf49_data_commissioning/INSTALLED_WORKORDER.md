# Installed source-edition workorders

The maintained `starforge` CLI exposes the original SF49 commissioning carrier and
SF77 workorder builder. A package containing the
[source-owned contribution](../../scf-starforge-20261009/distribution/contributions/source-edition-commissioning.json)
also retains this complete SF49 directory: the commissioning guide, source and
receiving templates, imagery guidance and Python analysis guidance. The existing
builder includes the original support, comparison and workorder dependencies
through its normal source closure.

The commands invoke the original modules. Arguments, the caller's working
directory, standard input/output, interrupts and child exit status follow the
existing distribution CLI. These commands use the installed Node runtime and
the original retained files; this workflow needs no provider connection.

## Locate the commands in the selected release

Use a package built from a commit that includes the contribution. An older
installed package retains its own manifest and registration inventory; updating
one declaration inside that package is not a release update.

```sh
starforge source
starforge registrations --source source-edition-commissioning
starforge registrations --command source-edition-workorder
starforge registrations --command merchant-workorder
starforge source-edition-workorder --help
starforge merchant-workorder --help
```

Retain the actual source commit from `starforge source` with the operating
record. The registrations identify the original module and declaring source.
Help reads the installed source and opens no workorder or receiving directory.

| Command | Original implementation | Result |
| --- | --- | --- |
| `starforge source-edition-workorder prepare` | SF49 carrier over SF74 import and SF77 build | A resumable, source-bound bundle with its exact original inputs and attachments. |
| `starforge source-edition-workorder receive` | The same SF49 carrier | An independently located copy of the complete verified bundle. |
| `starforge source-edition-workorder replay` | The same SF49 carrier | Verification of retained bytes and rebuilt original SF77 outputs. |
| `starforge merchant-workorder` | Original SF77 CLI | Its three rendered workorder outputs from a saved handoff or intake. |

The full [source-to-customer commissioning guide](SOURCE_EDITION_COMMISSIONING.md)
defines source selection, coverage, correction, acceptance and original
receiving responsibilities. This page supplies the installed entrypoints.

## Select the original inputs

Use the completed support export with schema
`stellar-forge.merchant-support-handoff.v1` and its actual saved terms file.
The original SF74 importer validates the handoff and embedded workspace. The
original SF77 builder consumes the preserved support and workspace inputs.

When attachments are part of the handover, prepare a JSON selection using
[source-edition-attachments.example.json](source-edition-attachments.example.json).
Every file needs a unique `id`, meaningful `role`, original `name`, `path`,
exact integer `bytes` and lowercase SHA-256 `sha256`. Relative attachment paths
are resolved against this selection file's directory. The example's replacement
names and zero digests must be replaced with actual source-file metadata.

The comparison and delivery-field examples are input templates for their
respective original APIs. Attach them as labelled source files when useful; they
do not replace the support handoff. Original provider archives, reviewed
comparison reports and customer receiving results keep distinct roles in the
same inventory. Their original contents and recorded coverage travel unchanged.

Use one stable operation ID for a commissioning preparation. The following
paths are explicit placeholders for the operator's actual private directories.

## Prepare and verify the bundle

```sh
starforge source-edition-workorder prepare \
  --handoff /private/original/CASE.merchant-support.json \
  --terms /private/original/OWNER_TERMS.json \
  --attachments /private/original/EXACT_FILES.json \
  --id source-edition-operation-001 \
  --out /private/commissioning/source-bundle

starforge source-edition-workorder replay \
  --bundle /private/commissioning/source-bundle
```

Omit `--attachments` when no separate files were selected. An optional
`--at UTC_TIMESTAMP` sets the retained preparation time. When omitted, the
first preparation establishes the time and a same-directory continuation
reuses it.

A completed bundle contains:

- `request.json`, retaining the stable operation ID, original input hashes,
  selected attachments and preparation time;
- `originals/support.json` and `originals/terms.json`, with the exact input bytes;
- `attachments/ID/NAME`, for each selected original file;
- original `packet.json`, `seller-packet.html` and
  `acceptance-checklist.md` outputs;
- `manifest.json`, published last with the complete file inventory and native
  entry-module hashes.

The command returns JSON with `operationId`, `bundleId`,
`manifestSha256`, `generatedAt`, file and attachment counts, the original
workorder summary and `nativeSourceMatches`. Replay hashes every retained
file, imports the original support again and compares the rebuilt SF77 outputs
with the saved output hashes. A successful command therefore has both a
retained source identity and an original output comparison.

## Receive and reopen elsewhere

The receiving destination must be separate from the source bundle: it cannot
be the source itself, a child of it or its parent.

```sh
starforge source-edition-workorder receive \
  --bundle /private/commissioning/source-bundle \
  --out /private/receiving/source-bundle

starforge source-edition-workorder replay \
  --bundle /private/receiving/source-bundle
```

Receiving verifies the source bundle first, copies the exact declared inventory
and publishes the original manifest bytes last. The received `bundleId` and
`manifestSha256` must equal the source values. The second replay uses the
received originals and original native builder. Keep that actual output with
the receiving record.

A repeat of `receive` against an already completed matching destination
reopens and verifies it. An occupied destination retaining a different bundle
is an identity conflict. Select a genuinely different private destination for
a different bundle; preserve the original one.

## Continue an interrupted operation

Repeat `prepare` with the same directory, operation ID and exact inputs.
The carrier retains the first request's time and attachment bindings, resumes
its owned temporary files and publishes completion only after verification.
Changed inputs are reported as a different request. Do not delete or replace
the retained request to make them fit.

Repeat `receive` with the same source and destination to continue an
interrupted copy. Use `replay` to inspect completed output. The carrier checks
its loaded native entry modules before and after a build or replay. If the
installed source changed, reopen with the intended release and inspect the
returned source-match result; original output hashes are checked separately.

SF77's direct CLI has its original create-only behavior. It does not provide
the SF49 bundle continuation protocol. For the full retained source, attachment
and receiving flow, use `source-edition-workorder`.

## Use the original direct builder

For a workorder from one saved support handoff:

```sh
starforge merchant-workorder \
  --handoff /private/original/CASE.merchant-support.json \
  --terms /private/original/OWNER_TERMS.json \
  --out /private/workorders/new-workorder
```

The original `--intake` route also remains available, including its
`--after`, paired `--sf72-before` / `--sf72-after` and `--at` options.
Run `starforge merchant-workorder --help` for that original syntax.
The [SF77 guide](../../scf-starforge-20261009/sf77-merchant-workorder/README.md)
describes those native input contracts.

## Import the maintained APIs

```js
import {
  prepareSourceEditionWorkorder,
  receiveSourceEditionWorkorder,
  replaySourceEditionWorkorder
} from '@tokenjunkielabs/starforge-merchant/merchant/source-edition-workorder';

const prepared = await prepareSourceEditionWorkorder({
  handoff: '/private/original/CASE.merchant-support.json',
  terms: '/private/original/OWNER_TERMS.json',
  attachments: '/private/original/EXACT_FILES.json',
  operationId: 'source-edition-operation-001',
  directory: '/private/commissioning/source-bundle'
});

const received = await receiveSourceEditionWorkorder({
  directory: '/private/commissioning/source-bundle',
  destination: '/private/receiving/source-bundle'
});

if (received.manifestSha256 !== prepared.manifestSha256) {
  throw new Error('Receiving changed the original manifest');
}

const reopened = await replaySourceEditionWorkorder({
  directory: '/private/receiving/source-bundle'
});
```

The original SF77 exports are available from
`@tokenjunkielabs/starforge-merchant/merchant/workorder`. Both subpaths resolve
to the same maintained source files used by the CLI. They introduce no separate
workorder format or receiving implementation.
