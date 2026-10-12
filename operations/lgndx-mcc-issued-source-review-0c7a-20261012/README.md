# MCC issued-source receiving programme

This directory runs the complete issued-source edition for the existing LGNDX opportunity project. It selects the original delivered revision-133 portable, composes the exact merged MCC source, applies the prepared issued-document review through the original store API, and opens the resulting named package in a fresh receiving workspace.

Operation: **LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012**  
Project: **opp_c414e4b0-302f-0005-bda6-cb8906d7a644**  
Application source: [2e666ad2e63db286c97d7f1a33e16249c043dfa0](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/2e666ad2e63db286c97d7f1a33e16249c043dfa0/stellar/scf-starforge-20261009/partners/lgndx-opportunity-operations)  
Issued-source implementation: [PR 1763](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1763)

## Complete receiving path

The selected edition has **41 source and license files**. The original 36-file release supplies the maintained application and dependencies. The six-file source selection in **source-overlay.json** adds the five original MCC review files and selects the current dossier implementation. Each complete source file is checked against its Git blob identity before being placed in **source.zip**.

The receiving driver has three phases:

1. **Restore.** Import the original delivered portable into this operation's private workspace. Check project identity, revision 133, all 34 requirements, all 34 coverage rows, and the two original named packages.
2. **Apply.** Call the maintained **applyIssuedReview** and **exportIssuedReview** implementation. Its nine source imports, 74 business actions, four source reviews, and one named-package creation make **88 original API calls**, producing **revision 221**. The same operation preserves the original project, company/capability/teaming information, and both earlier named packages while retaining the issued PWS/RFI/notice and the reviewed requirement, coverage, response, question, and milestone changes.
3. **Receive.** Import the selected revision-221 named portable into a separate buyer-receiving workspace. Check the full source bytes, 34 requirements, 34 coverage rows, and three named packages. Re-export the selected named package and compare the complete object to the original delivered object.

The existing applicator records each prepared request and expected revision before dispatch. Its own replay logic uses the original retained request IDs and project history. This programme calls that API directly; the authoritative implementation and document review are described in the [issued-source guide](../../stellar/scf-starforge-20261009/partners/lgndx-opportunity-operations/references/issued-source-review/README.md).

## Use the completed LGNDX delivery on a receiving host

The saved customer kit carries the complete original source and revision-133 portable in one file. Select it with **--delivery-kit** when preparing this original operation on an equipped host. The reader verifies the whole delivered ZIP, finds the retained portable by its exact byte count and SHA-256, and verifies all 36 source/license files against their retained source manifest. It then composes the same six current source changes and enters the original restore/apply/receive programme.

| Selected delivery | Identity |
| --- | --- |
| Filename | LGNDX_Opportunity_Operations_Kit_20261012.zip |
| Bytes | 6,032,266 |
| SHA-256 | ee1b02586058a80985672ffd160a6f88c84bcdd1ca1ea67879e28d4dd9bec5e3 |
| Saved file | libfile_518f91738b2c8191a2e9cc143b89cb07 |
| Original native file | file_000000006fa881f59b5754acc3a68560 |
| Baseline source | 36 files / 776,223 bytes at 8505a3ec99d584261754a2edcfca4113766dcc5b |
| Complete portable | 14,822,528 bytes / 9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140 |

The [original completed delivery](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791780811923049?thread_ts=1791759228.107759) records these identities and the completed revision-133 project. Retrieve that exact existing file through the authorised saved-file route. The native materialization request can pin both the saved file and its underlying native version:

~~~json
{
  "items": [{
    "library_file_id": "libfile_518f91738b2c8191a2e9cc143b89cb07",
    "file_id": "file_000000006fa881f59b5754acc3a68560",
    "file_name": "LGNDX_Opportunity_Operations_Kit_20261012.zip"
  }]
}
~~~

When that route returns a signed transfer descriptor, give the complete descriptor to the original file-transfer helper on the accepting host and retain it privately. **--delivery-kit** takes the resulting ordinary ZIP file. The reader uses its verified members directly and records the actual source-manifest and portable member names in the original selection. It materializes the maintained source ZIP and retains the delivered kit as the exact baseline input.

~~~bash
python3 -B operations/lgndx-mcc-issued-source-review-0c7a-20261012/prepare.py \
  --operation-root "$MCC_OPERATION" \
  --delivery-kit "$MCC_COMPLETED_DELIVERY" \
  --node "$MCC_NODE" \
  --controller-host "$MCC_CONTROLLER_HOST" \
  --private-root "$MCC_PRIVATE_ROOT" \
  --memory-reservations-root "$MCC_SHARED_MEMORY_ROOT" \
  --disk-reservations-root "$MCC_SHARED_DISK_ROOT" \
  --worker-root "$MCC_WORKER_ROOT" \
  --launch
~~~

Use this selection before the operation's first native dispatch. An already prepared operation keeps its existing programme and selection; continue that retained record through the original controller. A receiving-host transfer preserves the same operation and first-dispatch ownership. The selected delivery and original source/handoff pair are mutually exclusive inputs.

## Original separate input pair

These are fixed inputs to this one existing operation. The preparer verifies the complete bytes before creating its selection.

| Input | Bytes | SHA-256 |
| --- | ---: | --- |
| Original merged LGNDX source ZIP, lgndx-source-8505a3ec.zip | 233,798 | ec7b4967fc62ae3c30fb703b01bb1c91fcfffd6ad24c143f8f59854084a13596 |
| Prepared issued-source project-update.json | 896,542 | f2156f48c784568a56b1eef853e6a717a3f90d09c65f9695fbaceb44e6034d61 |
| Original completed native-handoff.zip | 5,739,854 | 7218fc1adb8e647bb90ce2a92a27ad1e96c42195b18020cf8347d0e4db939cfc |
| ZIP member handoff/current-receiving-portable.json | 14,822,528 | 9512b0bf69c34748df36bdc08f8b2aa0b06117eaacbafb6d38e035f5dd797140 |

The baseline source is the complete merged [8505a3ec edition](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/8505a3ec99d584261754a2edcfca4113766dcc5b). The current selected dossier Git blob is **8458167af2e1fb03420042b095d03f10c326185f**; the original portable receiver remains **dae6154ded7a88c367e844807ecec664aca4200f**. The merged MCC applicator is **cfdc00d0a5af2908cb1b3f14bbcc677737072ad7**.

The complete prepared packet is included at [inputs/project-update.json](inputs/project-update.json). It retains the issued-document bytes, acquisition identities, all nine selected sources, the 74 reviewed business actions, the four source reviews, and the named-package request. Its exact Git blob is **c8bfb3dabb2557fd95dd8a35fcf301eea5b71208**. The preparer selects this adjacent file by default and verifies the same 896,542-byte/SHA-256 identity before dispatch. An explicit **--project-update** path can select a verified byte-identical receiving copy.

The original operation custodian also retains the baseline source ZIP and completed native handoff. The separate-input mode below consumes those original files or their verified byte-identical receiving copies. Each prepared operation records the actual selected input path; its native continuation reuses that selection.

## Host selection and preparation

Use the maintained native foreground controller on the selected Linux host, Python 3, and an existing Node 24 executable. The application uses the original Node built-ins and selected source closure. The controller must expose **load_native**, **ForegroundLaunch**, **launch_options**, retained artifacts, **artifact-on-success**, and the shared memory/disk admission options.

Select four distinct locations:

- The checked-out programme directory containing all seven programme files, including delivery.py, and the complete inputs/project-update.json packet.
- A persistent private operation directory for selection.json, native records, the paired checkpoint, and completed handoff.
- A private working directory for the application databases, source materialization, and temporary files.
- The existing controller and its original shared admission directories.

The working directory must be disjoint from the retained operation, programme source, original inputs, Node executable, and controller. **prepare.py** records the absolute selected paths. Preserve that selection for subsequent continuations.

The example below prepares and launches the one original operation. Substitute actual existing receiving paths. Host paths are explicit; the exact prepared project update is selected from this checked-out programme. No environment or account is created.

~~~bash
python3 -B operations/lgndx-mcc-issued-source-review-0c7a-20261012/prepare.py \
  --operation-root "$MCC_OPERATION" \
  --baseline-source "$MCC_BASELINE_SOURCE_ZIP" \
  --baseline-handoff "$MCC_BASELINE_HANDOFF_ZIP" \
  --node "$MCC_NODE" \
  --controller-host "$MCC_CONTROLLER_HOST" \
  --private-root "$MCC_PRIVATE_ROOT" \
  --memory-reservations-root "$MCC_SHARED_MEMORY_ROOT" \
  --disk-reservations-root "$MCC_SHARED_DISK_ROOT" \
  --worker-root "$MCC_WORKER_ROOT" \
  --launch
~~~

The three shared-root options are optional when the existing native controller's environment already selects those same original directories. When a receiving worker has explicit shared paths, pass them so this operation participates in its existing admission and reservation accounting.

Omit **--launch** to prepare a reviewable source selection. Preparation checks every original source file, composes the 41-file source ZIP, parses the Python helpers, runs Node's syntax check on the receiving driver, and writes selection.json last. A repeated preparation from this checked-out programme reuses byte-identical files and rejects a different selection. It does not overwrite another selected operation.

The native runtime declaration includes the actual Python executable and existing stdlib/platstdlib directories, alongside the original controller, Node executable, exact programme inputs and selected delivery. The maintained controller retains that observed closure in its original runtime registration.

The launcher requests **1,024 MiB peak memory plus the controller's 256 MiB reserve**, with clean-cache accounting and memory-backed storage included. It requests **64 MiB additional persistent output plus a 16 MiB reserve**. The original baseline portable is 14.8 MB and its compressed handoff is 5.7 MB; the selected output budget also covers the advancing paired checkpoint, its atomic replacement, and the new eight-format package. Node uses a 512 MiB old-space limit and 4 MiB semi-space limit. Keep the full declaration in the original shared controller; admission determines when that host has room.

For a per-invocation private filesystem, keep the entire foreground operation within that invocation until its controller has retained the output artifacts. The persistent checkpoint is the continuation authority after that private filesystem disappears.

## Continue the same native record

A prepared operation can start or reopen through its retained launcher:

~~~bash
python3 -B "$MCC_OPERATION/launch.py"
~~~

The launcher uses the fixed operation ID and the same native-records directory. It calls the maintained native.start with a ForegroundLaunch owner and hands its lifetime back through that controller.

When a previous native supervisor has ended, use the current controller's maintained status and runtime-handoff APIs before resuming. Reconcile the existing supervisor, request hash, runtime selection, and original record; a saved queue state by itself is not a liveness result.

The original controller's capacity continuation command is:

~~~bash
python3 -B "$MCC_CONTROLLER_HOST/native_foreground.py" resume-capacity \
  LGNDX-MCC-ISSUED-SOURCE-REVIEW-0C7A-20261012 \
  --records-root "$MCC_OPERATION/native-records" \
  --host-root "$MCC_CONTROLLER_HOST" \
  --report-format summary
~~~

A changed controller uses its existing native_runtime_handoff.py inspect and prepare path. A reviewed runtime-path amendment belongs in the original native record. Transfer the same prepared operation and retained source/checkpoint selection when changing hosts; first reconcile its original owner and supervisor.

The receiving wrapper also owns receiving.lock, passed into each actual Node child. An interrupted wrapper therefore cannot release that exclusion while its original child is still running. Its paired checkpoint includes the application workspace, buyer-receiving workspace, current operation journal, and handoff together. It restores those files together after private working storage is lost, publishing the operation journal atomically only after every selected state member has been restored.

Each completed phase is saved only after the original store has closed. A continuation reopens completed phases and continues the original incomplete phase. The applicator's request journal and retained project history govern exact-request replay inside the apply phase.

## Retained outputs

| Output | Use |
| --- | --- |
| selection.json | Exact operation, application source, programme/source hashes, original input identities, and selected host paths. |
| source.zip | The complete frozen 41-file application/source closure and manifest. |
| native-records/ | The existing controller's admission, process, artifact, and continuation state. |
| native-state.tar.gz | Private paired journal/workspace/buyer-receiving/handoff checkpoint. Keep its original record association. |
| execution.json | Phase exits, checkpoint identities, finalization state, and completed output digests. |
| customer-handoff.zip | All eight named exported formats, the issued-review result, receiving result, and source identity. |
| customer-result.json | Completed customer receiving projection with project/revision, package and source identities, and named output hashes. |

The eight named formats are portable JSON, HTML, Markdown, requirements CSV, capabilities CSV, teaming CSV, milestones CSV, and questions CSV. The merged applicator prefixes the CSV filenames with their format so every named output is retained.

A successful reopen hashes all three completed outputs and returns the existing handoff. Native checkpoint and execution records remain private operating state. The customer package contains the original named exports and completed receiving projection.

## Source and execution state

This programme was published while the cloud executor was returning environment_offline before process creation. The complete original LGNDX operation had already delivered revision 133. Its current-dossier compatibility continuation has a separate existing native record. The MCC issued-source programme is the prepared continuation for the approved new business edition; this directory's publication does not advance that project by itself.

The source composition and original store/applicator interfaces were reviewed against the exact selected blobs. The actual operation's execution.json, original API journal, and completed output identities report its eventual receiving outcome. The programme creates its one original record only when the selected host accepts the launcher.
