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
includes both water-quality and water-quality-managed commands, the water
project and analysis SDK exports, the scientific job export, and all four
original browser assets.

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
