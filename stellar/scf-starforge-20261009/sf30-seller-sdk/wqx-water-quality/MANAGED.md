# Managed water quality and Open Waters

The water-quality application opens the maintained WQX project and scientific
workspace through Stellar Forge Applications. Source acquisition, saved
analysis, original measurement units and detection limits, Open Waters choices,
merchant editions and customer purchases continue to use that same project.

The complementary [scientific job](jobs/README.md) runs a complete native review
or Open Waters bundle through the same scientific engine. Its original sealed
file inputs, job identity and full ZIP result travel through the existing
merchant and customer job workspaces.

## Install and open the application

Select a Stellar Forge runtime whose source contains this complete directory,
the original Applications manager and the source-owned
distribution/contributions/wqx-water-quality.json registration. The distribution
includes the water-quality, water-quality-managed and water-quality-decisions
commands, the water project and analysis SDK exports, scientific jobs, the
complete decision workflow/model/table SDK exports, and all five original
browser assets, including the bulk receiving table.

In Applications, choose **Water quality and Open Waters**. Give it an operator
label and a private project directory. An existing project reopens its original
selection, capture requests, source files, reviews, plans and merchant editions.
A new directory must be beneath an existing private parent. Applications creates
it with private permissions when the reviewed configuration is saved.

Review the configuration, save it, complete the original runtime connection
when Applications requests it, then review and start the saved application.
**Open** enters the existing sample review workspace. The original Applications
operation also exposes direct downloads for a selected scientific review and
Open Waters plan.

The project directory is the application's resource identity. Two saved
applications cannot concurrently start the same managed project. The native
launcher also keeps the existing Linux flock mechanism for the whole running
workspace lifetime, including shutdown.

### Settings

| Setting | Use |
| --- | --- |
| Private water project | Existing private project, or a new directory under a private parent. |
| Complete source bundle | Optional original complete review or Open Waters JSON file, up to 128 MiB. |
| Saved review | Optional original review ID for its report, JSON, CSV, GeoJSON and complete source download. |
| Saved Open Waters plan | Optional original plan ID for locations, results, crosswalk, report, references and complete receiving bundle. |
| Private buyer configuration | Optional existing SF88 buyer configuration. Its file remains private on the host. |
| Original facilitator | Optional existing HTTPS native facilitator. |
| Use a loopback development facilitator | Explicit selection of a local http://127.0.0.1 facilitator for development. |
| Merchant listener port | The port used when the operator starts an original staged edition inside the workspace. Zero selects a free port. |
| Local port | The water workspace listener. Zero selects a free loopback port. |
| Private environment JSON | Existing Applications environment-file support; values remain on the host. |

A review records full SHA-256 values for the source, selected bundle, buyer
configuration and retained project decisions. Large bundle files are hashed as
streams. Saving and starting re-read the selected inputs. If an operator edits
the source or project between review and start, the current configuration can
be reviewed again.

## Receive a complete source edition

For the first start, select an empty private project directory and the complete
original review or Open Waters bundle. The launcher uses the original
receiveReviewBundle or receiveOpenWaters implementation. Receiving validates
the full member graph and source values; Open Waters receiving also reproduces
the original plan and validates every operating artifact against it.

The retained import identity makes the same bundle reusable on subsequent
starts. An interrupted receive continues through its original import intent.
A project already containing another review must use the workspace's existing
project and receiving controls.

A complete review bundle supplies the original review ID. A complete Open
Waters bundle supplies both its review and plan IDs. The direct download list
then contains the original scientific outputs and, when applicable, all six
Open Waters outputs. Explicit saved IDs select an existing decision and are
checked against the actual opened project.

The original workspace also supports receiving from its **Receive a complete
private review** and **Open Waters** controls, importing a retained native
capture, or saving an exact WQX source selection and acquiring it.

## Operate the original scientific workflow

1. Open the retained capture. Review the source dates, location identifiers,
   characteristics, measurement units, status, qualifiers, detection conditions
   and reported limits.
2. Save the scientific review with its original capture and reviewer choices.
   Numeric summaries follow the maintained analysis rules. The source records
   and reasons for exclusion remain in the report and exports.
3. In Open Waters, select the saved review, retain the receiving choices and
   inspect the source-to-target crosswalk. Existing location identifiers and
   reviewer decisions belong to that saved plan.
4. Download the full receiving outputs:

| Output | Native endpoint |
| --- | --- |
| Location import | /api/open-waters/PLAN/locations |
| Result import | /api/open-waters/PLAN/results |
| Complete crosswalk | /api/open-waters/PLAN/crosswalk |
| Receiving report | /api/open-waters/PLAN/report |
| Reference data | /api/open-waters/PLAN/references |
| Complete source and receiving bundle | /api/open-waters/PLAN/bundle |

The scientific review separately provides HTML, JSON, CSV, GeoJSON and its full
source bundle under /api/reviews/REVIEW/FORMAT. The application returns the
maintained native file bytes and filenames.

## Merchant and customer operations

The application opens the original merchant and customer tab. Prepare an
edition from a saved review, stage its existing payment terms and seller
origin, and start that edition through its original operator control. The
managed launch does not select a new purchase or change payment terms.

When a private buyer configuration is selected, the original customer controls
prepare, execute, reopen and export the selected intent. Each new source page
uses its original continuation and a new purchase intent; reopening an existing
intent retains that intent's original result. The same existing buyer receives
and verifies complete files.

Stop the running merchant through its existing control to change launch
configuration. The application-wide Stop operation also closes the original
merchant after it drains the workspace.

## Stop, reopen and recover

Use Applications **Stop**, or send SIGINT/SIGTERM to the managed CLI. The original
workspace cancels retained acquisition controllers, finishes tracked operations
and queued mutations, closes the merchant and listener, then releases its
project lease. It records the original launch ID and completed shutdown in the
private project.

Starting the same saved application again creates a new process and listener
over the original project. Refresh its start review so it records the current
saved selection and files. The original project binding, import receipts,
capture IDs, review IDs, plan IDs and edition IDs remain available. Applications
receives its new URL from the specific child it launched.

A full original source bundle can be received into another private project
through the same receiving workflow. Keep the original project available until
that receiving operation and its full downloads have completed.

## Native CLI and SDK

Prepare a private parent and inspect the selected existing project:

~~~sh
mkdir -m 700 /private/water
starforge water-quality-managed inspect \
  --project /private/water/potomac \
  --review potomac-quarter-open-waters \
  --plan potomac-quarter-open-waters-01
~~~

Open a complete received edition:

~~~sh
starforge water-quality-managed serve \
  --project /private/water/potomac \
  --bundle /private/received/potomac-complete-open-waters.json \
  --port 0 --merchant-port 0
~~~

The same commands can run directly with Node at
sf30-seller-sdk/wqx-water-quality/managed.mjs. The ordinary water-quality CLI
remains available for original acquisition, analysis, export and purchase
operations.

~~~js
import {
  reviewWaterQualityManaged,
  startManagedWaterQuality,
} from '@tokenjunkielabs/starforge-merchant/seller/water-quality/managed';

const reviewed = await reviewWaterQualityManaged({
  directory: '/private/water/potomac',
  reviewId: 'potomac-quarter-open-waters',
  planId: 'potomac-quarter-open-waters-01',
});
const application = await startManagedWaterQuality(reviewed, { port: 0 });
console.log(application.launch.url);
// Operate the maintained workspace, then drain that same application.
await application.close();
~~~

## Source and project lifetime

The maintained launcher is managed.mjs; the original domain engines remain
project.mjs, workspace.mjs, provider.mjs, samples.mjs, analysis.mjs,
openwaters.mjs and merchant.mjs. The existing Applications adapter is
distribution/runtime-workspace/application-wqx-water-quality.mjs.

The project retains managed-water-quality-binding.json,
managed-water-quality-launch.json and managed-water-quality-stop.json beside
its original native records. The launch binds the original source and selection
SHA-256 values, private project identity, original review and plan, loopback URL,
and the actual process. Applications accepts that startup only from its
reviewed command and child process.

The scientific job entrypoint is jobs/application.mjs, exported as
waterQualityReview. Its two named source slots and complete customer receiving
contract are documented in jobs/README.md. Set WQX_JOB_TEMP_ROOT to an existing
private scratch directory in the original worker's environment. The temporary
source project is confined to that directory and the job returns its full
operating result through the original output lifecycle.

## Complete bulk receiving review

The **Bulk decisions** section works from one saved immutable Open Waters plan.
It exposes exact receiving targets for project settings, locations, activities,
results, value translations, detection-limit choices and receiving reference
lists. Each target retains its original record and native field. The complete
source plan identifies which saved choice and current value the analyst is
reviewing.

1. Choose the saved source plan and **Open source plan**. The initial table shows
   targets needing attention. Clear that filter to inspect all receiving targets,
   or narrow the table by record kind, native field and exact source/value text.
2. Select individual targets, the visible page, or **every matching target**.
   Selection persists across pages and filters; the selection count shows its
   full size. A common exact value applies to one selected kind and receiving
   field. Each row also has its own decision, value and reason controls.
3. Choose **Keep current choice**, **Set exact value**, or **Remove saved choice**.
   Keep retains the source plan's current mapping. Set supplies the exact
   receiving string, including an explicit empty string. Remove drops the
   saved override so the original mapper or default supplies the value.
   Reference lists take a JSON array of exact strings. A blank limit target
   keeps the reported limit in its original source/comment representation.
   Changed choices retain an analyst reason.
4. Download the current source-bound decision JSON or the **complete editable
   CSV/TSV table**. The table includes every target in the source plan and the
   current draft choices. Edit its action, value and reason columns and retain
   its source and target identity columns. Importing the completed file opens
   that exact source plan and replaces the current draft. The parser retains
   quoted tabs, line breaks, spaces and literal strings.
5. Name the new receiving plan and decision review, then **Preview complete
   native plan**. The original Open Waters normalizer and planner apply all
   decisions. The preview reports before/after receiving counts, each changed
   choice and remaining native issues. **Inspect full receiving preview**
   opens the original detailed locations, activities, results, limits,
   references and issue views.
6. **Save decision review and plan** retains the complete decision document,
   reasons, source identities and preview identity beside the newly saved
   native plan. The same review and plan names resume an interrupted save.
   The original source plan remains the basis of that review.
7. Reopen the saved decision review to inspect its choices and complete outputs.
   **Revise these decisions in a new plan** starts a fresh review and plan name
   with the prior decisions. The saved review includes editable CSV/TSV, decision
   JSON, an operator report, all six native receiving exports and a portable
   review bundle.

The portable bundle contains the complete resulting native project and the
original receiving options and decisions needed to reproduce the source and
resulting plans. Receive it into an empty private workspace, then reopen the
decision review and all original exports. The standalone CLI and source
contract are documented in [the receiving review guide](review-sheet/README.md).

Opening workspace sections uses one application lifetime for each interface.
Refresh updates their saved-project lists while retaining the current drafts.
Managed source review includes the bulk model, table parser, workflow and
browser module along with the original native engines.

## Receive the complete installed application

The maintained `receive-managed.mjs` command operates through the actual installed
Runtime Workspace and Applications HTTP routes. It attaches the existing READY
runtime, reviews and saves the selected WQX application, adopts that original
runtime, starts its original managed command, consumes all eleven report/source
downloads, stops the original process, and starts the same saved project again.
Each complete download is streamed and compared with the original project
engine's filename, byte count and SHA-256. It retains the original source,
scientific review and Open Waters plan throughout both launches.

Copy `managed-receiving.example.json` into the private receiving directory, set
mode 0600, and fill `runtimeDirectory`, `expectedSourceCommit` and
`expectedManifest` from the actual completed runtime installation. Select the
existing received `projectDirectory`, its original `reviewId` and `planId`.
The independently received project from `jobs/receive.mjs` can be used directly.
To receive into a new project, also set `bundleFile` to the complete original
Open Waters JSON and retain its actual review and plan IDs. The project's parent
must already be private.

```sh
node --expose-gc --max-old-space-size=384 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/receive-managed.mjs \
  /absolute/private/water-receiving/managed-input.json
```

The command retains `managed-receiving.json` beside its original Applications
controller. Use the same configuration and directory after a reconnect. Save,
adoption and managed Start use their retained native operation IDs; an incomplete
reading attempt that was already stopped keeps its original record before a
following managed attempt starts. A completed run includes both original launch
identities, the stable project binding, all browser, workspace and download reads selected by the installed asset manifest,
and 22 complete report/source transfers. This source has five browser assets,
so both launches produce 34 complete HTTP reads. The original full data and result archives
remain in the selected project and original scientific receiving operation.

The command uses the existing source/runtime profile and native dependencies.
The controller and original workspace retain the normal Applications Open,
Stop and recovery controls.
