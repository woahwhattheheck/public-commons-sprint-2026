# Install and reopen the operator

## Runtime

Use an existing Linux environment with:

- Node.js **22.16 or newer**, exposing node:sqlite and DatabaseSync. Node 24 is also supported.
- Python 3 with its standard sqlite3, zipfile and tarfile modules.
- The native tar and flock commands.
- A normal browser able to open the machine's loopback address.

There are no npm or pip application dependencies and no hosted Actions workflow. The optional Practice browser continuation uses an already installed Python Playwright and Chromium; the operator itself does not need them.

The release is a complete source closure. Extract it into a directory with the supplied revenue/ and stellar/ paths intact. The shared state-lease helper uses that original relative layout.

## Private workspace

Select a directory owned by the operating-system account running the operator. The application creates private directories and files. Keep this workspace separate from the source release.

From the extracted source root:

~~~bash
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs serve --directory /absolute/private/utility-workspace --port 8794
~~~

The launcher prints a JSON object with the complete local URL. Open that URL, including its fragment. Closing and reopening the server creates a new local session URL while retaining the same project data.

--port 0 selects a free port. The application serves only 127.0.0.1 and validates its Host, Origin and private session token.

Start by entering the operator/reviewer name and creating a Project or Practice workspace. The project timezone defaults to America/New_York and should describe the original service and meter clock. See [OPERATOR.md](OPERATOR.md) for source order and native interpretation.

## Complete encrypted backup

Close the browser operator process cleanly before making a full backup. Let an already accepted comparison finish or inspect its original worker state. The backup acquires the original host/queue/worker leases; it does not terminate someone else's active worker.

Set a strong passphrase in a named environment variable using the terminal's private input mechanism. For Bash:

~~~bash
read -r -s UTILITY_BACKUP_PASSPHRASE
export UTILITY_BACKUP_PASSPHRASE
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs backup --directory /absolute/private/utility-workspace --output /absolute/private/utility-workspace.utility.enc --passphrase-env UTILITY_BACKUP_PASSPHRASE
unset UTILITY_BACKUP_PASSPHRASE
~~~

Press Enter after entering the passphrase. Use at least 16 characters. Save the encrypted file outside the workspace and keep the passphrase separately. An existing backup filename is preserved; choose a new output path for a later backup.

The backup contains the full editable workspace: original source bytes, dataset versions, HMAC journal, source-pinned comparisons and reviews, migration ledger, native field files and all earlier frozen project ZIPs.

## Cold restoration

Use the original encrypted backup and its passphrase. The destination must be a new directory:

~~~bash
read -r -s UTILITY_BACKUP_PASSPHRASE
export UTILITY_BACKUP_PASSPHRASE
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs restore --input /absolute/private/utility-workspace.utility.enc --directory /absolute/private/restored-utility --passphrase-env UTILITY_BACKUP_PASSPHRASE
unset UTILITY_BACKUP_PASSPHRASE
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/cli.mjs serve --directory /absolute/private/restored-utility
~~~

The encrypted archive is authenticated before extraction. Restoration accepts ordinary workspace directories/files within the original source roots, verifies the original journal and attached source identities, and publishes the restored directory only after those reads succeed.

A frozen project ZIP is intended for review and delivery. The encrypted workspace is the editable continuation. The application preserves these two distinct artifacts.

## Source updates

Stop the operator before changing its application source. Keep the complete original source layout and select a released closure. Reopen the same private workspace with the same profile launcher. This release uses schema asheville.utility.v1.

Retain the release's SOURCE_MANIFEST.json with a project handoff when reproducing an implementation outcome. The application does not download packages or update itself.

## Operational size

Source uploads through the browser are limited to 48 MiB, supporting assets to 32 MiB, and native retained assets to 64 MiB. Table intake supports 200,000 records. A bill run selects at most 5,000 distinct accounts; choose a route or account selection for a larger predecessor estate.

A full backup restoration accepts at most 4 GiB of uncompressed files and 200,000 members. The original comparison service also retains its configured input/report/worker limits; these persist with that workspace.

## Optional complete Practice run

~~~bash
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/practice.mjs /absolute/new/private/practice-operation --browser
~~~

Set UTILITY_CHROMIUM if the existing browser is not /usr/bin/chromium. The optional browser continuation starts the application and native browser within the same local operation. It never attaches to a signed-in customer session.

The Practice folder is deliberately new. It retains generated source files, actual native operation results, screenshots when requested, frozen handoffs, a full encrypted backup, a private Practice-only passphrase and the original closed workspace. These files are useful for reopening the worked demonstration and can be retired as an owner-controlled completed Practice allocation after their chosen deliverables are retained.

## Build a complete portable source release

The repository includes a standard-library source packager. It selects the whole
application closure, including the shared ERP runtime and license, and excludes
operating databases, customer exports and browser state by using an explicit
source inventory. Repeated builds with identical source bytes and the same release
label in the same Python/zlib runtime produce the same ZIP bytes.

~~~bash
python3 revenue/erp-conversion-assurance/profiles/asheville-cis-2026/build_release.py --source-root /absolute/source/root --output /absolute/new/Asheville_Utility_Operator.zip --source-reference YOUR_RELEASE_REVISION
python3 revenue/erp-conversion-assurance/profiles/asheville-cis-2026/build_release.py --verify /absolute/new/Asheville_Utility_Operator.zip
~~~

The output path must be new. Publication is atomic and preserves an existing
artifact. SOURCE_MANIFEST.json records every included source filename, byte count,
SHA-256 and Git blob identity. The supplied source reference is a release label;
the per-file identities describe the actual packaged bytes. START_HERE.md gives
the complete application and Practice commands for a new receiving machine.

## Continue only the browser from an existing Practice

A native Practice that has already completed billing and adoption can continue
its UI on a receiving machine with existing Python Playwright and Chromium.
Transfer the **closed original workspace**, original result.json and
practice-files/ together. Include native-continuation-result.json when a separate
native continuation produced it. Preserve the private workspace permissions and
original journal identity; these generated Practice files do not belong in a
public source repository.

From the complete source extraction, use the existing operation path:

~~~bash
node revenue/erp-conversion-assurance/profiles/asheville-cis-2026/continue-practice.mjs /absolute/existing/private/practice-operation
~~~

This command does not invoke the Practice generator, calculate another billing
batch or enqueue another comparison. It reads the two original reviewed
comparison IDs and 5,000 adopted bills, opens the existing app, and runs the
desktop/mobile source-correction, upload, download and offline-photo browser
journey. It then closes and reopens that same workspace for a read-only browser
continuation. The original result, native continuation result and scenario are
preserved. Only the fixture paths in a separate new scenario are relocated.

Each invocation writes its outcome, browser outputs and screenshots under a new
browser-continuations/run-* directory. If a browser exits partway through, retain
that outcome and inspect its actual last step before another invocation; source
corrections already accepted by the app remain in the same workspace.
Use --read-only for a subsequent inspection that does not repeat the source
correction, file intake or offline return entry.

Set UTILITY_PYTHON and UTILITY_CHROMIUM to existing executables when needed.
Run the launcher and its browser child in one native invocation so they share
the same local network namespace. A browser that cannot access the server's
loopback address needs a supported receiving runtime before UI continuation.
