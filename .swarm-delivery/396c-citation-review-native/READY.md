# Complete citation-review native receiving

Operation: **SCF-RESEARCH-CITATION-REVIEW-396C-20261012**. The root seat owns its single full native launch. This is a new private two-question citation-review operation. D9B53's existing NCC customer operation keeps its original workspace, input and controller.

## Pinned complete source

| Selection | Exact identity |
| --- | --- |
| Repository | woahwhattheheck/public-commons-sprint-2026 |
| Product release | PR2061, merge d9c2e3e6f6b86883d76befb74cd252caacb0e698 |
| Release head | 1dcb4558495f6ffae7e3af338d1ab8ed820bce24 |
| Dependency source base | d60d878e9c7c042c58b26b9ec5aaee8e99ffd5a0 |
| Complete source-envelope.json | Git blob 03888169824bcffb2422f51622fcf6d7d4379f4a |
| Envelope bytes / SHA256 | 3,670,230 / 4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa |
| Source membership | 283 files, 3,527,883 exact original file bytes, 33 explicit release overlays |
| materialize-source.py | Git blob 615f8b7feec9203d5533a716085293f7ccefe096 |
| Materializer bytes / SHA256 | 7,101 / 217506524e606c658baf94707d3153b926d6f5c0bda67857ffcdbd9a984399f9 |

The envelope records the frozen dependency base and every final overlay separately. It includes all current Research browser assets, the original Merchant adapters and their complete relative-import closure, the original SDK files, the retained Crossref document builder, five exact public input files, and the original repository license. The source envelope preserves the original sf88.research-client.native-source.v1 format.

These are the final workflow, browser and intake pins included in that complete manifest:

| File | Git blob |
| --- | --- |
| citation-review-workflow.mjs | 70c358d322474c428b28780b5816510b498c2505 |
| citation-review-browser.mjs | c3f79fd632e66c239de2f53de0c5844a16a987e2 |
| citation-review-merchant.mjs | 49e092b6bc67a1f8957628033b7221e1014fd98a |
| crossref-documents.mjs | e7e40277df48cacddf00cf3b70823d3674a7d625 |
| crossref-document-cli.mjs | aa143c7813766f788d6147e27c1416517fc85e4b |
| sf30-seller-sdk/crossref/metadata.mjs | f2a2290a7a1bc0d9d6404b43289d6ec83388617f |
| CITATION_REVIEW.md | 9f619cbe2cbb5461a692f2d23f7d742b90c69edb |
| CITATION-REVIEW-OPERATOR.md | ea2974afa1380c5c312885944bc12a6f140eda2f |

The full 283-row manifest is authoritative for the remaining source paths and hashes. The materializer verifies the complete carrier, each UTF-8 body, each SHA256 and each Git blob identity before writing any source member. Existing exact files are reused. A different existing file produces an error and preserves its bytes. Final readback and .citation-source-materialization.json retain the complete selected source identity.

## Receive through the existing equipped host

The original source-stream receiver remains the existing transport for a large input when ordinary connected-file materialization is unavailable. Its exact unchanged source is Commons blob **1ac8cbbff8beda55c77b3ccb55193d095d93aa0f**. It uses Node built-ins plus the installed Linux flock command; its private host source is an independent equipped-host input.

The receiving owner first selects the actual installed receiver path and one persistent inbox. Its CLI is:

```sh
"$CITATION_NODE" "$CITATION_SOURCE_STREAM_RECEIVER" \
  --target /workspace/scratch/396c49963bae/citation-review-native/inbox/source-envelope.json \
  --input-id SCF-RESEARCH-CITATION-REVIEW-396C-20261012/source-03888169824bcffb2422f51622fcf6d7d4379f4a \
  --bytes 3670230 \
  --sha256 4b15d21cf32ba2a0f082209c828f2ba4beca19e98ceb2f8af1eeea7c15268caa
```

Use its existing commons.source-stream/v1 frame protocol and original READY/PROGRESS/COMPLETE responses. Resume from the acknowledged original prefix with matching prefix identity. The original command remains the single receiving process; the sender retains its full source text and reconciles that process before continuing. An already complete exact target is reusable.

The same exact source-envelope.json and materialize-source.py can be received from the release's delivery branch through the connected Git/file route. Preserve their exact byte identities above. Every later command uses this same inbox and project directory. Use ordinary persistent storage for source, native records and completed artifacts; invocation-private /dev is temporary only.

## Run the complete original workflow

The equipped owner supplies the actual Node 22+ executable, installed Playwright module and Chromium executable. Reuse its existing runtime and native admission with the measured complete browser/output footprint. The source materializer and document builder add no provider acquisition or dependency installation. This workload uses Node built-ins plus that explicit browser runtime.

Run the following sequence inside the root-owned native operation. Keep all values and target paths unchanged on reentry. The four runtime variables must refer to the actual equipped host. On a different accepted host, the root selects its absolute root path once before first dispatch and retains that path in the original native request.

```sh
set -euo pipefail
: "${CITATION_NODE:?Set the actual installed Node executable}"
: "${CITATION_PLAYWRIGHT:?Set the actual installed Playwright module path}"
: "${CITATION_CHROMIUM:?Set the actual installed Chromium executable}"
CITATION_ROOT=/workspace/scratch/396c49963bae/citation-review-native
CITATION_PROJECT="$CITATION_ROOT/project"
CITATION_RESEARCH="$CITATION_PROJECT/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers"
CITATION_INPUT="$CITATION_RESEARCH/examples/crossref-retraction-1758835919874651"
mkdir -p "$CITATION_ROOT/input"

python3 -B "$CITATION_ROOT/inbox/materialize-source.py" \
  --source-envelope "$CITATION_ROOT/inbox/source-envelope.json" \
  --directory "$CITATION_PROJECT"

"$CITATION_NODE" "$CITATION_RESEARCH/crossref-document-cli.mjs" \
  --provenance "$CITATION_INPUT/provenance.json" \
  --source-dir "$CITATION_INPUT" \
  --query "How does the registered retraction affect this cited work?" \
  --doi 10.1177/1758835919874651 \
  --doi 10.1177/17588359211061903 \
  --updates-doi 10.1177/1758835919874651 \
  --supporting README.md \
  --output "$CITATION_ROOT/input/crossref-document-edition.json"

CITATION_EDITION_SHA=$(python3 -B -c \
  'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' \
  "$CITATION_ROOT/input/crossref-document-edition.json")

"$CITATION_NODE" "$CITATION_RESEARCH/citation-review-workflow.mjs" \
  --operation SCF-RESEARCH-CITATION-REVIEW-396C-20261012 \
  --edition-file "$CITATION_ROOT/input/crossref-document-edition.json" \
  --sha256 "$CITATION_EDITION_SHA" \
  --run-directory "$CITATION_ROOT/customer" \
  --playwright-module "$CITATION_PLAYWRIGHT" \
  --chromium "$CITATION_CHROMIUM" \
  --target-doi 10.1177/1758835919874651 \
  --source-reference "Retained original Crossref public source documents"
```

The materializer source is syntax-reviewable independently. Its execution, the document conversion and the complete workflow must each retain their actual command outcome; source preparation does not imply a completed customer run.

## Source and expected customer result

The five retained files are the original work, its registered retraction notice, the registered-updates list, the original transfer provenance and the source note. The document CLI binds every original body to its source URL, exact hash, role and observed transfer provenance. Its provider is crossref-document. Unknown upstream status, headers and time remain unknown. The same notice's original optional-field variations are preserved as informational source differences.

The workflow receives that exact edition into two research questions, selects the cited work, attaches the affected findings, opens the original authenticated Research UI, reviews the grouped notice and preserves one original review request across replay. It exercises the same Merchant workspace connection, retains the original/reviewed/current reports, exports both portable formats and reopens each into a fresh private store. It also verifies that altered review history fails the original portable validation. The original source bodies remain available in the received edition throughout.

Completion is the original **customer/result.json** with schema sf88-citation-review-workflow.v1 and state COMPLETE. It includes original IDs/revisions, source binding, Merchant export identities, both reopen results and an explicit artifact list with byte counts/hashes. The native controller's actual successful result accompanies it. Preserve the complete result and each listed artifact before ending any temporary output namespace.

Use result.json's selected artifacts for the customer handoff. Connection records, browser profiles and private workspace/control directories retain their ordinary local custody. The two detailed product guides in the source describe operator review and recovery.

## Current receiving state

The 283-file envelope and all final product source pins are verified and durable. At guide preparation, the full root-owned native operation has no dispatched process or record. The root's earlier read-only terminal requests ended before process creation. The next equipped owner therefore reports the first actual native record/session under the operation above before running the sequence, and remains its sole controller through completion.
