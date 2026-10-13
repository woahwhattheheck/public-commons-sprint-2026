# Budibase commissioning command line

This command line operates the same complete commissioning core as the browser.
It retains the original Budibase export, source inspection, plans, actual operating
observations, issued editions, request receipts and complete customer handovers.

## Install and open

Use Node.js 22 or newer on Linux or another POSIX filesystem that supports hard
links, atomic rename and directory synchronization. Place cli.mjs, core.mjs,
CLI_GUIDE.md and UPSTREAM_LICENSE.txt together. They use Node built-ins and need
no package installation. The upstream source contract is pinned in the core.

Choose an existing private working directory with room for the complete source,
project and recovery request files. Project and request files are private mode
0600; the lease directory is 0700. The project file is a complete JSON envelope.
The original core project can be exported separately with open --out.

    mkdir -m 700 /private/budibase-job
    node cli.mjs create --project /private/budibase-job/project.json --id client-workflow --name "Customer workflow" --request /private/budibase-job/create.request.json
    node cli.mjs open --project /private/budibase-job/project.json

A create operation requires a new project path. Repeating its exact request opens
that same created project, including later saved work. An unrelated existing
project is preserved. All commands print structured JSON; failures return exit 1
and a concrete error. Read commands do not acquire the writing lease.

## Receive the exact original export

    node cli.mjs capture --project /private/budibase-job/project.json --source /private/original-workspace.tar.gz --request /private/budibase-job/capture.request.json

The capture retains complete original bytes, SHA-256, the member inventory, original
document revision records, source findings and its selected resource inventory.
The core accepts native gzip TAR workspace exports, project packages, complete
legacy catalogue templates and the supported plaintext PouchDB NDJSON format.
It preserves unknown members in the unchanged original archive.

For encrypted native members, put the exact password in a separate private UTF-8
file and add --password-file /private/export-password.txt. One final newline is
removed. The password is read only to inspect the source and is omitted from the
retained request and project. Its file locator appears in the private request
binding. The decoder uses the pinned native PBKDF2-SHA512, AES-256-CTR and inner
gzip contract. Original encrypted archive bytes remain encrypted in the capture;
the resulting inspection contains configuration facts and field names.

The core enforces a 64 MiB original export, 256 MiB expanded TAR, 20,000 members
and 24 MiB database-document inspection limit. Complete projects and handovers
are JSON and therefore require memory for their whole histories and source bytes.
Choose a receiving machine appropriate for the actual project. Original source
files and customer configuration stay in the selected private directory.

Open reports every capture with its source identity and actual document counts.
To return to an earlier capture:

    node cli.mjs select --project /private/budibase-job/project.json --capture capture-ORIGINAL_ID --request /private/budibase-job/select.request.json

## Prepare the complete commissioning plan

    node cli.mjs plan-template --project /private/budibase-job/project.json --out /private/budibase-job/plan.json

Edit that complete JSON. It includes the actual source's connectors and roles,
all source findings, and suggested source/data/workflow/screen/query/automation/
handover/recovery cases. Assign each connector or role's owner and decision;
resolve every retained finding with its actual decision. Choose the real receiving
installation, destination workspace, target Budibase version, operator and reviewer.
Record the customer outcome, implementation changes and the recovery plan.

Supported target modes are new-workspace, update-existing and project-import.
The core binds project exports to project-import and complete workspace exports
to a workspace route. Native existing-workspace import preserves existing-table
rows and the destination identity; project import remaps resource IDs and imports
applications and automations disabled. Native import, destination configuration,
data reconciliation and publication are performed through the selected Budibase
installation. Record their results in the corresponding operating cases.

    node cli.mjs plan --project /private/budibase-job/project.json --input /private/budibase-job/plan.json --expect 1 --request /private/budibase-job/plan.request.json

Reopen an earlier saved plan and its corresponding retained source:

    node cli.mjs plan-select --project /private/budibase-job/project.json --plan plan-1 --request /private/budibase-job/plan-select.request.json

The selected source is fixed into the saved plan. --expect is an optional explicit
project revision. If omitted on a new request, the command uses the current
revision while holding its lease. A stale explicitly selected revision is rejected
before project replacement.

The commercial field can hold the complete selected workshare input and calculated
outcome from the commissioned model. Keep its quantities and funding choices tied
to the source and agreed work. Saved plan history remains immutable.

## Record actual outcomes and issue the handover

Write an observation JSON for one saved case:

    {
      "caseId": "source",
      "outcome": "passed",
      "actor": "Named receiving operator",
      "detail": "Describe the actual source and destination result, including any discrepancy.",
      "reference": "The retained original operating record or artifact identity"
    }

Use passed, failed or needs-work. Each observation is appended and tied to the
exact plan digest. Use a distinct request file for a new observation.

    node cli.mjs observe --project /private/budibase-job/project.json --input /private/budibase-job/observation.json --request /private/budibase-job/observation-1.request.json
    node cli.mjs ready --project /private/budibase-job/project.json

ready returns every case and its latest observation, including missing or failing
cases. Corrective work is recorded with another observation. Changing the plan
creates a new plan digest and requires its own operating outcomes.

After the cases are complete, prepare acceptance JSON:

    {
      "acceptedBy": "Named accepting operator",
      "acceptance": "The actual scope and accepting decision"
    }

    node cli.mjs issue --project /private/budibase-job/project.json --input /private/budibase-job/acceptance.json --request /private/budibase-job/issue.request.json
    node cli.mjs handover --project /private/budibase-job/project.json --out /private/budibase-job/Customer_Complete_Handover.json

The handover contains the entire core project, every original capture's bytes,
saved plans, observations, edition history, the selected operator report, all
source digests and the complete CLI/core/guide/license files. An explicit earlier
edition can be selected with --edition edition-N; the full project history travels
with it. Use a new output path for a changed edition or source programme.
An already existing byte-identical output is recognized without replacement;
different output bytes are preserved and reported.

## Independent receiving and original-source downloads

    node cli.mjs receive --project /private/customer-copy/project.json --input /private/budibase-job/Customer_Complete_Handover.json --request /private/customer-copy/receive.request.json
    node cli.mjs open --project /private/customer-copy/project.json
    node cli.mjs source --project /private/customer-copy/project.json --capture capture-ORIGINAL_ID --out /private/customer-copy/original-workspace.tar.gz

Create the private customer-copy directory first. receive also accepts a complete plain core project or an original CLI project file, so an unfinished operating project can be recovered at a new independent path. The input byte identity and previous CLI origin are retained in the new origin. Receiving checks the complete
project, every retained original source, saved plan digests and the selected
operator report before creating the new independent project. The same native
capture and edition identities survive receiving. A new local plan or observation
then uses an original new request against that project's current revision.

source writes the complete raw original archive or plaintext export and verifies
its exact bytes and SHA-256. The caller chooses the output path; the tool returns
the original filename and capture identity. It never extracts archive paths into
the filesystem. Use the original Budibase import route described in the report
when operating the selected destination.

For interchange with the browser core:

    node cli.mjs open --project /private/customer-copy/project.json --out /private/customer-copy/core-project.json

This exports the complete core project as plain JSON. Complete issued handovers
use the same tjlabs.budibase-complete-handover/v1 format consumed by core.receive.
The CLI's additional programme files do not replace the native project or report.

Compare two retained original source editions:

    node cli.mjs compare --project /private/budibase-job/project.json --before capture-EARLIER --after capture-LATER --out /private/budibase-job/Source_Changes.json

The comparison retains both capture IDs and identifies added, changed and removed
resources. Data and external service behavior remain part of the actual operating
course.

## Resume exactly after interruption

The first attempt saves a complete immutable request file before applying its
mutation. That file contains the original operation ID, expected revision,
timestamp and full input. A capture request also includes the original source bytes
and inspection, so later recovery needs neither the source path nor the password.

    node cli.mjs resume --request /private/budibase-job/capture.request.json

The same original command with exactly the same arguments also reuses its request.
It deliberately replays the bytes already recorded there, even if an input file
at that name was subsequently edited. Use a new request file for changed input.
Request files are separate from project and lease-history paths.

If the project save completed but its response was lost, the core's request receipt
returns that original result without another revision. If the request was saved
before a failed project write, resume performs the same operation. A saved stale
request retains its original expectation and can be inspected; new intent belongs
in a new request. Original requests and their input files should remain with the
private operating directory until the handover and recovery copy are received.

Every project replacement is a fully written, synchronized private sibling file
published by atomic rename, after comparing the original complete file SHA while
holding the same project lease. Initial files and all exports use create-only hard
link publication. Complete existing files are never truncated in place. If a process stops between publishing an initial project link and removing its private temporary name, the next leased continuation recognizes only its matching same-parent UUID temporary links, verifies inode, device, owner and private mode, removes those redundant links and synchronizes the parent. Unrelated hard-link aliases remain preserved. Replaying an already received result also synchronizes the project directory to complete an interrupted publication.

## Original writing lease

The project has an adjacent .leases directory. Each operation publishes a complete
numbered lease by exclusive hard link and later writes its immutable release.
Generations are never reused or deleted. Concurrent writers compete for the same
next generation; only one can publish it. This avoids deleting another process's
new lock while recovering an old one. Canonical real parent paths ensure that
symlink aliases use the same project lease.

    node cli.mjs lease --project /private/budibase-job/project.json

If a process was interrupted before release, inspect its retained token, PID,
process start identity, host, boot and PID namespace. Once the original process has
ended, release that exact generation on its original host:

    node cli.mjs lease-release --project /private/budibase-job/project.json --token ORIGINAL_TOKEN
    node cli.mjs resume --request /private/budibase-job/capture.request.json

lease-release verifies that the original process ended in the retained host, boot and PID namespace, using its PID and process-start identity. Different boot identities remain unverified rather than being treated as proof of a remote process ending. A running or unverified remote process keeps its
original lease. Receiving a complete handover, plain core project or original CLI project file at a fresh project path is the
independent operator transfer; it leaves the original operation history intact.

## Complete command reference

| Command | Required inputs | Result |
| --- | --- | --- |
| create | project, id, name, request | New project with durable creation origin |
| open | project; optional out | Complete summary or plain core project |
| capture | project, source, request; optional password-file, expect | Exact source and inspection |
| select | project, capture, request; optional expect | Select an earlier retained capture |
| plan-template | project; optional out | Complete editable source-linked plan |
| plan | project, input, request; optional expect | Immutable saved plan |
| plan-select | project, plan, request; optional expect | Select an earlier plan and its source |
| observe | project, input, request; optional expect | Original plan-bound observation |
| ready | project | Full current case outcomes |
| issue | project, input, request; optional expect | Accepted edition after all cases pass |
| compare | project, before, after; optional out | Complete resource change projection |
| handover | project, out; optional edition | Whole customer project and programme |
| receive | project, input, request | Independent complete project creation |
| source | project, out; optional capture | Exact original source bytes |
| resume | request | Same original operation and receipt |
| lease | project | Current generation and process status |
| lease-release | project, token | Release a confirmed ended original process |

All inputs in the table are named --options. Quoted strings retain spaces. The
command line performs local commissioning record and file operations; the selected
Budibase installation remains the native application execution and publishing
surface.

## Receive the rendered product and attachments

After the complete CLI course, follow the full desktop/phone and attachment procedure in OPERATING_GUIDE.md, section “Inspect the delivered application and every attachment.” Open the exact rebuilt index.html, import the complete original core project or accepted handover, operate capture/plan/result/edition/commercial controls, view the real rendered output and every exported attachment, then reopen the extracted programme and original handover in a fresh browser profile. Use the existing operation and source identities. A completed CLI response does not by itself complete the rendered application receiving. Retain actual viewed images and repair concrete presentation or control defects in this same delivery.
