# Offline Measurements and workbook dependencies

Approved portability item 7, owner direction `2026-10-14.1`.

Run the producer with Python 3.11 or newer from the current application tree.
It uses the maintained `source_tools/native_runtime/binary_dependencies.py`
reader. Keep that existing component; it reads the native loader metadata
without running a Windows or Mac executable on the build machine.

## Acquire once in the existing cloud build environment

```sh
python source_tools/build_node_payloads.py fetch --output /tmp/eco-node-inputs
```

The five inputs are the official Node 22.16.0 Windows x64 ZIP, Mac Intel and
Apple Silicon XZ archives, and the original openpyxl 3.1.5 and et_xmlfile 2.0.0
universal wheels. Each download is checked against the fixed publisher digest.
The two wheel sizes and digests are the existing collection opener's pins.
An already matching file is reused. A conflicting input is left untouched.
Keep the acquired original archives in the internal build store for reuse.

Node source: https://nodejs.org/en/blog/release/v22.16.0 and
https://nodejs.org/download/release/v22.16.0/SHASUMS256.txt.
Wheel source: https://pypi.org/pypi/openpyxl/3.1.5/json and
https://pypi.org/pypi/et-xmlfile/2.0.0/json.
All exact URLs, sizes and SHA-256 values are in the producer's fixed constants.
This acquisition command is separate from offline building and opening.

## Build the complete three-platform overlay

```sh
python source_tools/build_node_payloads.py build \
  --inputs /tmp/eco-node-inputs --wheels /tmp/eco-node-inputs \
  --output /tmp/eco-node-overlay --zip /tmp/Ecosystem_Node_Offline.zip
```

Both output names must be fresh. A completed artifact is not overwritten.
The build emits the original executable and full bundled Node license under
`measurements-runtime/<platform>/`, the original wheels and readable wheel
licenses under `workbook-dependencies/`, and `NODE_DEPENDENCIES.json`.
Paths, byte lengths and hashes are measured from the received bytes. Native
architecture, executable type, loader imports and declared minimum OS are read
using the existing shared parser. ZIP entries retain executable permissions.

The default builds all three release targets. `--target` is for a partial
internal receiving job, not a complete final release. The sidecar records
whether all three targets are present. The final system requirement is the
highest requirement across the complete scientific runtime, not just Node's
loader minimum. The original Node binary is retained without ad-hoc signing,
patching or compiler replacement.

## Join into the selected collection runtime

Extract the overlay at the collection root using the existing assembly path.
The descriptor paths are **collection-relative**, not scientific-prefix-relative.
The original root `prepare_runtime_dependencies.py` consumes exactly these
`node` and `node_license` rows. Generate the joined descriptor before freezing:

```sh
python source_tools/build_node_payloads.py compose \
  --runtime /build/collection/NATIVE_RUNTIME.json \
  --overlay /tmp/eco-node-overlay/NODE_DEPENDENCIES.json \
  --output /build/NATIVE_RUNTIME.with-node.json
```

Use that new file as `NATIVE_RUNTIME.json` in the final assembly. The command
preserves every scientific runtime, bootstrap, package, path and unrelated
field already selected. It adds the two dependency records to existing target
rows, reuses an identical prior record, and leaves a differing record unchanged
with an explicit conflict. A missing scientific target must be supplied by the
existing runtime producer; this tool never invents or substitutes it.

Keep `NODE_DEPENDENCIES.json` in the final root alongside its payloads and the
joined descriptor. It retains publisher origin and actual native-image details.
Do not overwrite the shared application, root launchers, study registrations,
workspaces, mutable customer data or the 82 original completed runs.

## Opening and integration

The existing native opener selects its scientific Python. Its current locked
offline preparation places the matching Node beside that interpreter, retains
its license inside the prefix and installs the two supplied wheels without an
index or dependency solve. It invokes the application's existing Measurements
capability probe and workbook imports. No npm install or recipient download is
needed. An explicit `MEASUREMENTS_NODE` remains authoritative.

Use the same final Windows opening and workbench operation already assigned to
the release, with the final assembled bytes. Resolve any concrete exception
against that same selected runtime. Platform-specific opening on Mac follows
its existing receiving course. UI or workbench changes require actual focused
click/visual use; this build-only component changes neither. Preserve the
owner's complete current direction, focused validation and private final ZIP
delivery instructions in cloud and receiving copies.
