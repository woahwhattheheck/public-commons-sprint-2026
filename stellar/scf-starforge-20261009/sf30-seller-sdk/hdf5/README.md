# HDF5 array workbench

A persistent operator for inspecting HDF5 files, selecting exact array regions, retaining typed results, and delivering a result with the file and selection needed to reconstruct it. The included Node operator and merchant MCP provider use the same Python workspace. The publisher connects those results to the existing dataset release, customer review, pagination, and recovery APIs.

## Start with an existing file

Use Node 24 or the version selected by the installed merchant package, and a Python environment containing h5py and NumPy. The supplied requirements select h5py 3.15.1. Reuse a compatible existing environment when available. The native result records the actual datatype and selection; the receiving record identifies its original file and output hashes.

Keep the workspace and configured input directories private to their operating account. They must be canonical directories with mode 0700. The application holds one exclusive workspace lease; use the running operator or its MCP connection rather than opening a second writer.

```sh
install -d -m 700 /private/arrays /private/array-inputs
node hdf5/app.mjs --workspace /private/arrays \
  --python /private/python/bin/python3 \
  --input-root /private/array-inputs
```

The launcher prints a loopback URL with a private fragment capability. Open that exact URL. The server binds 127.0.0.1 and requires the capability for every API request. Do not put the URL or its Bearer token in a public handover. A remote host can forward its loopback port through its existing authenticated access route.

Files can be uploaded directly in the operator. CLI and MCP file paths must be under a configured input directory. The original bytes are copied into the workspace and hashed before native inspection. A new version does not alter a previously retained file.

The seven screens follow a complete working sequence:

1. **Sources:** upload a file, supply a stable source ID, label and source URL, and retain a version. To update a source, select its current head as the expected version.
2. **Array:** inspect the selected source version. Browse native hard-linked groups and datasets; inspect datatype, shape, compression, attributes and dimension-scale metadata.
3. **Selections:** enter explicit axes and optional compound fields. Save the normalized selection against the exact file version, then extract it.
4. **Results:** page through typed values and original coordinates, use the native dataset query, and download the retained source, typed JSON Lines, CSV, configuration or full packet.
5. **Publisher:** prepare the selection with the operator's actual seller payment terms and service origin. Review, publish, stage and activate through the existing dataset publisher. Customer review and page sessions use the independently configured buyer workspace.
6. **Receiving:** upload a complete packet and its whole-file SHA-256. The independent workspace verifies the archive and reconstructs the selected values from its retained HDF5 file before adopting the result.
7. **Operations:** reopen an exact operation ID after a lost response. Inspect its state, cancel before adoption, or resume the same saved request. A completed resume rechecks its retained files.

## Exact selections

A selection names one absolute HDF5 dataset path. Every non-scalar dataspace axis is explicit:

```json
{
  "dataset": "/DS1",
  "axes": [
    {"start": "2", "count": "3", "stride": "4", "block": "2"},
    {"start": "1", "count": "4", "stride": "3", "block": "1"}
  ],
  "fields": null
}
```

This selects two adjacent elements from each of three blocks on the first axis, and one element from each of four blocks on the second. The result has shape 6 by 4. Coordinates in every result row refer to the original zero-based source positions.

All axis numbers are canonical decimal strings. Bounds must fit the native dataset. Strides are positive and cannot overlap their blocks. The current UI also accepts ordinary nonnegative JSON integers within the exact JavaScript range, but decimal strings are the portable representation.

For a scalar dataset, use an empty axes array. Its shape is `[]` and it yields one logical value. A null HDF5 dataspace has shape `null`, cannot be sliced and yields no value rows. A zero-length array retains its array shape and also yields zero rows; these are different native states.

For a compound dataset, `fields` is either null for the complete datatype or an ordered array of exact field names. For example:

```json
{
  "dataset": "/DS1",
  "axes": [{"start": "0", "count": "4", "stride": "1", "block": "1"}],
  "fields": ["Serial number", "Temperature (F)"]
}
```

Use field names shown by the actual file. h5py does not support every nested compound projection; an unsupported request remains an explicit native error. It is never replaced with a flattened or guessed value.

Selection IDs bind the file version, native dataset path, normalized axes and fields. Result edition IDs bind that selection and the reader contract. Reusing an operation ID with different request fields returns a conflict.

## Value representation

The typed JSON Lines artifact is the complete value interface. CSV is a portable projection containing three string columns: `row`, `coordinates`, and `value`. The last column contains the same typed value as JSON text. This preserves integer and floating-point distinctions across clients whose JSON numbers have a narrower range.

| Native value | Retained representation |
| --- | --- |
| Signed or unsigned integer | Decimal string with its dtype |
| Boolean | Boolean value |
| Floating point | Decimal description and original scalar bytes; NaN, infinities and negative zero remain distinct |
| Complex number | Typed real and imaginary components |
| Fixed or variable-length string/bytes | Base64 bytes plus declared encoding and length metadata |
| Compound record | Ordered named fields with each field's typed value |
| Array datatype or variable-length array | Its own dimensions and recursively typed elements, inside one logical dataspace element |
| Object or region reference | Source-file-local target and region information, or an explicit null/unresolved value |
| Null dataspace | Shape null and no value rows |

The original source file is the authority. The reader does not infer physical units, a coordinate reference system, calendar/time interpretation, CF metadata conventions, or a scientific meaning from a dtype or attribute name.

Object addresses are local identities within the selected file. Hard links can provide multiple names for one object. They are not new independent measurements. Dimension scale names may repeat, and HDF5 itself does not require scale lengths to match the dimension; the inventory preserves the actual axis, label, scale path and source object.

Variable-length attributes returned as Python text are recovered with UTF-8 and surrogateescape, as h5py specifies, while their declared HDF5 encoding remains metadata. Dataset strings remain bytes. The application never applies `asstr()` or silently trims, normalizes or reformats source text.

## Linked and external data

Group browsing records soft and external links without following them. Value access walks only hard links inside the selected immutable file.

Raw external storage and virtual datasets are separately reported dependencies. The current reader does not open them for value extraction. This avoids presenting a missing VDS source's fill value as a verified source measurement. Select a self-contained original file for this release; do not rename or substitute an external dependency to force a read. There is no automatic network or filesystem search for linked files.

The native child disables dynamic HDF5 filter plugins. Standard HDF5 compression supported by the selected h5py build remains available. A file needing an uninstalled custom filter returns the original native failure.

## CLI and host API

`node hdf5/app.mjs --help` prints usage without starting a workspace. Use `--action` with a JSON payload file for a single request:

```sh
node hdf5/app.mjs --workspace /private/arrays \
  --python /private/python/bin/python3 \
  --input-root /private/array-inputs \
  --action source.import --payload import.json
```

Example `import.json`:

```json
{
  "operation": "source-import-01",
  "source_id": "instrument-export",
  "path": "/private/array-inputs/export.h5",
  "label": "Approved instrument export",
  "expected_head": null,
  "origin": {
    "url": "https://the-original-provider.example/export",
    "description": "The operator-selected original file"
  }
}
```

The example URL is a placeholder for the selected file's actual source, not a provider called by the application. Capture does not fetch the URL.

The principal actions and payload fields are:

| Action | Payload |
| --- | --- |
| `status` | Optional source offset/limit |
| `records` | kind, optional offset/limit and source ID for versions |
| `source.get` / `version.get` | source ID / version SHA |
| `source.import` | operation, source_id, path, label, expected_head, origin |
| `inspect` | version, native path, optional offset/limit |
| `attributes` | version, path, optional attribute name or page |
| `selection.save` | operation, version, selection |
| `selection.extract` | operation, selection_id |
| `result.page` | edition, offset, limit |
| `dataset.query` | edition, query string |
| `edition.export` | operation, edition |
| `edition.receive` | operation, archive_path, expected_sha |
| `operation.get` / `operation.resume` | ident |
| `operation.cancel` | operation |
| `artifact.read` | edition, name, offset, length |
| `publisher.prepare` | edition, payment, origin, optional path |
| `publisher.action` | original publisher action and payload |
| `publisher.export` | original export kind and ID |

HTTP clients send `POST /api/action` with `{"action":"…","payload":{…}}` and the private Bearer capability. `POST /api/upload?kind=source` accepts raw bytes; `kind=packet` uses the packet limit. Optional `X-Content-Sha256` binds the upload to an already selected SHA.

`GET /api/artifact` accepts an edition/name pair, an original delivery operation, or an original publisher export identity. HEAD and one explicit byte range are supported. A returned range is checked against the full original file, and has the full-file SHA in the response header. The MCP `artifact.read` response additionally includes the range SHA and Base64 bytes. This default performs full-file verification for each range; use the complete HTTP download for large artifacts.

The low-level Python CLI has the same native source/selection/edition actions. Its `--stdio` mode is the included Node bridge's bounded, correlated protocol. It is not a separate network server.

## Merchant MCP connection

The installed merchant loads the additive HDF5 provider through its distribution contribution. No replacement merchant catalog or dataset publisher is introduced.

Create a private connection file:

```json
{
  "schema": "stellar-forge.hdf5-workspace-connection.v1",
  "workspaces": {
    "arrays": {
      "label": "Scientific array delivery",
      "directory": "/private/arrays",
      "python": "/private/python/bin/python3",
      "inputRoots": ["/private/array-inputs"],
      "buyerWorkspace": "/private/independent-buyer"
    }
  }
}
```

Create the selected directories before configuring MCP. Each directory has one writer, so close its standalone operator before opening it through the merchant. A configured buyer directory is optional until a customer page session is requested.

Set the existing merchant's `hdf5WorkspaceConnection` to this file. The provider contributes workspace discovery, source/version browsing, selection, result, operation, delivery and publisher/customer tools. The original merchant still controls its server transport, caller authorization and approval policy.

The additive `initializeHdf5Merchant({directory,connection,name})` export creates a merchant setup using the existing release store and customer export directory. It saves an immutable setup intent and verifies the resulting configuration through the original merchant loader. Repeating the same setup reuses it; an unrelated populated directory is rejected.

## Publisher and customer handover

Preparing a publisher package preserves:

- the exact original HDF5 file and source version;
- the normalized selection and complete result edition;
- typed JSON Lines and array metadata;
- the native CSV and dataset configuration;
- the seller route generated from the configured payment terms and origin.

Those files enter the existing publisher's draft/review/publish lifecycle. Its release stage/activate/rollback/start/stop operations keep their original expected-generation checks. Snapshot activation retains the existing expected snapshot and revision checks. The HDF5 application does not substitute a new settlement or customer session engine.

The typed projection uses native string columns and exact cursor pagination. A row whose escaped JSON representation exceeds 768 KiB is rejected before publisher preparation because the existing dataset endpoint has a 900 KiB page budget. Its complete local artifacts remain available. Select smaller compound fields or a smaller array value to create a publishable projection.

Customer review reads the running original seller offer. Preparation binds the reviewed offer and original accept index. Page sessions use only the independently configured buyer workspace, with the original row/page/payment limits and signed-attempt recovery. Publication, runtime activation, an observed purchase, and a complete received result are separate states. The application does not label one of them as another.

## Independent reconstruction packet

A complete packet has exactly nine root members:

```text
manifest.json
source.h5
source.json
selection.json
edition.json
array.json
values.jsonl
dataset.csv
dataset.json
```

The manifest binds the edition and every other member's bytes and SHA-256. Source and selection identities, redundant edition fields, output closure and archive bounds are checked before adoption. The receiver then invokes the same native reader on the retained HDF5 file and exact selection. Every output file and the full array metadata must match the offered edition.

A received historical version does not move an already configured source's head. Receiving does not deploy a seller, connect a payer, or repeat a purchase. Its output is the independently reconstructed source/result workspace.

Archives are created deterministically into a private, create-only destination. A repeated completed export verifies that original destination before returning it. Receiving rejects duplicate, extra, encrypted, symlink or unsupported archive members. Extraction has fixed file/member limits, and never uses member paths as arbitrary filesystem destinations.

## Interruption, cancellation and shutdown

Every mutating action needs a stable operation ID. Its action and original payload are written before execution. The first imported file is retained before h5py inspection, so a later request does not recapture a changed source under the old ID.

Cancellation is accepted before adoption begins. A synced, request-bound commit marker records that boundary independently from the display state. It survives process interruption and reopening; an already published packet cannot later be reported as cancelled. After this boundary, inspect or resume the same operation to finish reconciliation.

Use Operations → Resume exact original after a lost response. Do not reupload a different file or use a new operation ID as an automatic retry. A completed resume goes through the action's original source/result/destination checks. A changed source head requires an explicit new reviewed import with that current expected head.

The bridge allows three ordinary requests and reserves a fourth slot for status or cancellation. Only one native h5py worker runs per workspace. The server stops intake and drains accepted requests before closing the original publisher and Python process. Native children are bounded, receive the parent-death signal, and are closed by their owning workspace.

## Resource limits

| Boundary | Limit |
| --- | --- |
| Original HDF5 file | 256 MiB |
| Logical selected elements | 100,000 |
| Fixed-size selected allocation | 64 MiB |
| Typed result and CSV artifact | 64 MiB each |
| One typed element | 1 MiB |
| Publisher row projection | 768 KiB |
| Native request wall time | 120 seconds |
| API request | 1 MiB |
| Native response | 16 MiB |
| File range response | 256 KiB |
| Complete packet input | 512 MiB |

Variable-length data can allocate more than dtype.itemsize suggests. The native child also has an address-space and CPU limit; a failure remains a retained interrupted operation, not a partial successful edition. The limits do not establish scientific validity of the source.

## Native receiving example

`examples/native-receiving.py` owns the original receiving lock and launches `native-receiving.mjs` with two original HDF Group sample files, a private output directory and the selected Python. It imports, selects, extracts, queries, exports, independently reconstructs and reopens those same inputs. Optional browser and publisher arguments exercise the actual operator and original publisher. Its input hashes are checked before any operation, and its original run intent is retained. The Python owner also retains and reaps the exact Chromium process identity if the Node journey is interrupted.

```sh
python3 examples/native-receiving.py --directory /private/hdf5-receiving \
  --gzip /private/inputs/h5ex_d_gzip.h5 --compound /private/inputs/h5ex_t_cmpd.h5 \
  --source-root /installed/source --source-manifest /private/selected-source.json \
  --source-manifest-sha256 SELECTED_SOURCE_SHA256 \
  --browser --playwright-module /configured/node_modules/playwright
```

The source manifest uses `stellar-forge.hdf5-receiving-source.v1` with the complete selected `files` inventory (`path`, `bytes`, `sha256`) relative to `--source-root`. Its expected whole-file hash is explicit. All application members and original dependency members are verified before a native operation. The receiving intent also retains the actual Node binary, Python/h5py/HDF5/NumPy identities and loaded native files; optional browser execution binds its selected executable before launch. A different source or runtime requires a separately identified receiving run.

Use `--publisher-config /private/publisher.json` to supply the original `payment`, `origin` and `path` for native publisher preparation. The two original HDF Group files must match the published hashes in the retained input package. Browser screenshots cover all seven screens at desktop and phone sizes. The final immutable result is published only after the actual original workspaces and HTTP operator close; each attempt and cleanup result remain available separately.

The HDF Group files are published format examples, not observational science or a customer's dataset. The example does not download them, invent replacement values, create a provider account, or claim a paid transaction. Keep the original source/license/provenance packet with the receiving result.

## Primary format references

- [h5py datasets and selections](https://docs.h5py.org/en/stable/high/dataset.html)
- [Groups, hard links, soft links and external links](https://docs.h5py.org/en/stable/high/group.html)
- [Virtual dataset source mappings](https://docs.h5py.org/en/stable/vds.html)
- [Dimension scales](https://docs.h5py.org/en/stable/high/dims.html)
- [String bytes and encodings](https://docs.h5py.org/en/stable/strings.html)
- [Special datatypes](https://docs.h5py.org/en/stable/special.html)
- [Object and region references](https://docs.h5py.org/en/stable/refs.html)
- [HDF Group published C API examples](https://docs.hdfgroup.org/archive/support/HDF5/examples/api-c.html)

These references describe the native format and reader contracts. They do not replace the exact source file, selected runtime version or actual receiving result.
