# Prepare and operate the original semantic runtime

The DCAT workspace can inspect, download and hand over retained semantic results without Python. A new native validation or saved-snapshot comparison needs the original semantic interpreter and its dependencies. These deployment commands prepare that interpreter in a separate private directory, retain the complete resolved wheels and installation evidence, and bind the chosen receipt to each native operation.

Preparation does not open a catalogue project, acquire its writer lease, run a catalogue validation or accept a release. The existing native engine, context selection, findings, comparison scope and operator decisions keep their original meanings. See [SEMANTIC_CATALOGS.md](SEMANTIC_CATALOGS.md) and [SEMANTIC_COMPARISONS.md](SEMANTIC_COMPARISONS.md).

## Choose the host and directories

Use Linux with an existing absolute Python 3.11 or later executable that supports `venv` and its bundled pip. The original semantic engine requires:

| Original requirement | Version |
| --- | --- |
| RDFLib | 7.6.0 |
| pySHACL | 0.40.1 |
| cryptography | 50.0.1 |
| PyLD | 3.3.0 |

The product retains the original requirements, engine, worker, license, notice and source manifests beneath `ckan/vendor/semantic-operator/`. Preparation verifies those selected source bytes before resolution. It does not change the four requirements or replace the original engine.

Choose an empty private runtime directory at its final absolute location, outside every catalogue workspace. Its parent must resolve to the real host location. Preparation creates the directory with owner-only permissions. Do not move a prepared virtual environment: installed scripts can contain its original absolute path. On another host or at another path, prepare a new environment from the retained wheelhouse.

For example:

```sh
starforge dcat semantic-runtime-prepare \
  --directory /srv/private/dcat-semantic-runtime \
  --python /usr/bin/python3.12
```

The command creates a separate `environment/` beneath that runtime directory. It does not install into the supplied base interpreter or an existing application environment. An existing nonempty unowned directory is rejected. A directory with this operation's exact original selection can resume after interruption.

Use the original installed `starforge` command. From a full source checkout, the corresponding entrypoint is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/dcat-cli.mjs \
  semantic-runtime-prepare \
  --directory /srv/private/dcat-semantic-runtime \
  --python /usr/bin/python3.12
```

In a delivered product archive, that checkout path is beneath the archive's `source/` directory. The runtime directory is host configuration and stays outside the portable catalogue `.ckanw` archive.

## What preparation retains

The operation first binds the selected base executable and exact original source manifests. It probes the base Python, creates the virtual environment at its final path, resolves wheel-only distributions, writes a complete hash-locked requirement set, installs exclusively from those retained wheels, checks dependencies, and imports the original engine and its pinned libraries.

The default resolution source is the explicit Python Package Index URL `https://pypi.org/simple`. The owned pip invocation disables host/global/site pip configuration and uses isolated mode. It accepts binary wheels only. If the selected Python/platform has no suitable wheel for a dependency, preparation fails with the original log; it does not silently compile a replacement or relax a version pin. Normal configured HTTP(S) proxy variables can still supply the host's network route.

Every resolved transitive distribution has a retained wheel filename, package name/version, byte count and SHA-256. The generated `requirements.lock` binds every selected wheel hash. Installation then uses `--no-index --require-hashes` against only the retained wheel directory, with no second resolution. The exact resolved transitive versions are recorded in this environment's receipt; they are not advertised as universal versions fixed by the original four-line requirement file.

The runtime contains:

| Retained path | Purpose |
| --- | --- |
| `selection.json` | Immutable base interpreter, original source, resolution mode and selected paths. |
| `source/` | Complete selected original semantic source and both manifests. |
| `wheels/` | Every exact wheel selected for this interpreter/platform. |
| `wheel-selection.json` | Resolved package list and wheel identities. |
| `requirements.lock` | Full resolved distribution/version/hash requirements. |
| `environment/` | Installed virtual environment at its final stable path. |
| `attempts/<id>/` | Original command arguments, logs, terminal exit/signal receipts and Python/import probes for that attempt. |
| `progress.json` | Current preparation phase or retained failure/interruption. |
| `runtime.json` | Complete successful receipt with original source, interpreter, distributions, import results and file inventories. |

Logs and receipts are private. They may contain host paths and original installer diagnostics. The successful receipt inventories all installed environment files and symlink targets, retained wheels and copied source. It also binds the base executable, requirements, selected import probe and installation receipts. The host operating system and base Python standard library remain host prerequisites; a virtual environment receipt is not an operating-system image.

The command prints a concise result with the receipt path/hash, Python selection, lock hash and package count. The complete evidence remains in `runtime.json` and its retained files.

## Offline preparation and exact reuse

To resolve from an existing complete local wheelhouse:

```sh
starforge dcat semantic-runtime-prepare \
  --directory /srv/private/dcat-semantic-offline \
  --python /usr/bin/python3.12 \
  --wheelhouse /srv/private/retained-semantic-wheels
```

The wheelhouse must contain every compatible dependency wheel for the selected Python and host platform. This route uses `--no-index`; an incomplete wheelhouse fails rather than accessing another index. The resolved selected wheels are copied into the new runtime and bound by its own receipt.

After a wheel selection and lock have been retained, a resumed preparation verifies and reuses those exact files. It does not resolve newer transitive dependencies. If a source, wheel, lock or original selection differs, the operation stops and preserves the prior evidence. Choose another new private runtime directory to make a deliberately different selection.

Once `runtime.json` is READY, repeating the same prepare command verifies the complete selected original source, base interpreter, retained wheels/lock, import evidence and installed file inventory. It does not run pip, access a package index or re-import arbitrary newly resolved code. Inspection is also read-only:

```sh
starforge dcat semantic-runtime-inspect \
  --directory /srv/private/dcat-semantic-runtime
```

Inspection checks exact files rather than only trusting installed package names or a previous success flag. Added, removed or changed installed files, modified symlink targets, a replaced base executable, changed source, and altered custody receipts fail inspection. To upgrade or repair a READY environment deliberately, retain the old directory and prepare a new one.

## Select the runtime through the original private environment

Create a new private JSON environment file:

```sh
starforge dcat semantic-runtime-environment \
  --directory /srv/private/dcat-semantic-runtime \
  --out /srv/private/dcat-semantic-environment.json
```

To preserve an existing migration Python selection, publisher credential references and other original application values:

```sh
starforge dcat semantic-runtime-environment \
  --directory /srv/private/dcat-semantic-runtime \
  --input /srv/private/current-dcat-environment.json \
  --out /srv/private/dcat-with-semantics.json
```

The input uses the existing private Applications environment format: a JSON object of string environment variables. The exporter preserves those values and sets:

| Variable | Bound value |
| --- | --- |
| `SCF_DCAT_SEMANTIC_PYTHON` | The exact prepared `environment/bin/python` path. |
| `SCF_DCAT_SEMANTIC_RUNTIME` | The final private runtime directory. |
| `SCF_DCAT_SEMANTIC_RUNTIME_SHA256` | SHA-256 of the complete retained `runtime.json` bytes. |

The output is created only in an existing owner-only directory. An existing identical output can be reused; a different existing file is preserved and rejected. The exporter does not overwrite another private configuration, alter `HOME`/`CODEX_HOME`, or change a running application.

The migration interpreter remains a separate selection. `SCF_DCAT_PYTHON` and `SCF_DCAT_RUNTIME_PROFILE` still follow [DCAT_ENGINE.md](DCAT_ENGINE.md) and [PORTABLE_RUNTIME.md](PORTABLE_RUNTIME.md). Semantic preparation does not install the GSA converter's dependencies.

### Managed Applications

In the original Applications console, choose **DCAT catalog workspace**, select the existing private catalogue project and select the newly exported private environment file. Review and save that application selection, then start it.

Preparation of this managed launch binds the original product/runtime source and project identity as before. When a semantic interpreter is explicitly selected, it additionally uses the original executable selector to bind the real executable, any executable symlink and adjacent virtual-environment configuration. A prepared runtime selection binds its private directory, immutable receipt, original selection, lock and wheel-selection files. Full runtime inspection verifies the underlying environment before launch and again when the authenticated original startup is checked.

If a saved application was created before this semantic runtime selection, review and save it again after choosing the new private environment. An interpreter/receipt change requires an updated deliberate selection. Retained report-only projects can still open without a semantic interpreter.

### Direct CLI or other original callers

The private JSON file is consumed by the original Applications environment reader. It is not a shell script. For a direct CLI service, supply the same three exact values through that process's existing environment management.

Before each actual native preparation, snapshot, coverage, validation or comparison child is dispatched, the original bridge checks the configured prepared runtime. It retains the receipt binding in the admitted native request and requires the same receipt and selected interpreter for subsequent phases. Therefore the check also applies to CLI and other callers that do not use Applications.

Inspection, download, archive receiving, historical result replay and owner close do not invoke Python or require today's semantic runtime to be installed. Selecting a prepared runtime never installs packages during a catalogue operation.

An explicitly selected manual `SCF_DCAT_SEMANTIC_PYTHON` remains supported without `SCF_DCAT_SEMANTIC_RUNTIME`. That route keeps the original engine/source/version checks but has no prepared-environment receipt or complete wheel/file inventory. A prepared-root selection requires all three exported variables; do not mix its root/digest with another interpreter.

## Interruption and recovery

One preparation process owns the runtime lock. A second writer cannot prepare the same directory concurrently. The helper is bound to its launching process, and every owned installer/probe child is bound to that helper. Cancellation terminates only those owned children, waits for their actual exit and records the original log plus exit/signal and timeout/cancellation cause.

A timeout, cancelled shell or missing package does not become READY. Inspect `progress.json` and the referenced private attempt directory. Logs and partial files remain evidence. Re-run the same prepare command with the same final directory, original base executable and wheelhouse selection. The retained original selection prevents a retry from changing the operation implicitly.

If the operating system kills the whole process without a graceful receipt, the lock is released by the process lifecycle and the retained incomplete attempt remains. A later identical preparation records a new attempt. Never infer successful installation from a directory's existence or an incomplete log.

Preparation refuses to rewrite changed immutable retained files. A partial immutable write may require selecting a new runtime directory after retaining the damaged attempt for diagnosis. It does not erase that directory to make a retry appear successful.

## Complete the actual customer operation

After preparation, use the original semantic customer programme or the existing UI/CLI to import the exact selected context/shapes profile, retain the original catalogue bytes, run the original native engine, inspect all findings and downloaded artifacts, document an operator decision and receive the whole saved project independently. Follow the actual worker's result and receipt rather than claiming execution from source review.

Before presenting a client or prospect-ready result, the producing operator must open and run the exact delivered version and actually use its important controls. Look at desktop and narrow layouts where relevant; inspect downloads, independent receiving/reopen, and every attachment as the recipient would. Read the actual semantic findings and coverage qualifications. Source inspection, syntax checks, HTTP receipts and peer approval do not replace this use. Fix visible defects directly and retain the actual version and resulting evidence.

Semantic conformance and class-presence measurements remain separate from complete SHACL target coverage, JSON Schema validity, record conservation and catalogue release acceptance. A successful runtime preparation proves the selected interpreter/source/dependencies are ready; it makes no assertion about any catalogue.

## Source and receipt interfaces

The maintained implementation is `dcat_semantic_runtime.py` plus `dcat-semantic-runtime.mjs`, called by the original `dcat-cli.mjs` before project opening. The managed adapter is the original `distribution/runtime-workspace/application-dcat.mjs`; the native factory is `dcat-semantic-native.mjs`.

The complete runtime receipt schema is `stellar-forge.dcat-semantic-prepared-runtime.v1`. The immutable preparation selection is `stellar-forge.dcat-semantic-runtime-selection.v1`; the exported environment receipt is `stellar-forge.dcat-semantic-runtime-environment.v1`. The native request retains the small `stellar-forge.dcat-semantic-runtime-binding.v1` record and exact complete-receipt SHA-256. All original source licenses/notices remain with the retained source.

Neither runtime receipt nor private environment belongs in a customer catalogue archive. The archive retains the original native request, source identities, results, findings, artifacts and operator decisions needed for historical receiving. A recipient who wants another native operation prepares its own host runtime and deliberately selects it.

## Carry the original wheel lock to a receiving host

The [portable semantic runtime procedure](SEMANTIC_RUNTIME_TRANSFER.md) exports the verified original source, all retained wheels, exact dependency lock and sender custody receipts. The recipient receives those complete inputs into its own private directory and runs the original offline preparation at a separate final environment path. The transferred package does not contain an installed virtual environment. Wheel/platform compatibility is checked by the actual recipient installation; an incompatible wheel set remains a receiving finding rather than triggering a different dependency resolution.

The received-input receipt (`READY_INPUTS`) and the installed runtime receipt (`READY`) are separate results. Only the completed runtime enters `writeDcatSemanticRuntimeEnvironment` and the original Applications receiving procedure. Existing saved reports and catalogue history can still be opened without preparing any interpreter.
