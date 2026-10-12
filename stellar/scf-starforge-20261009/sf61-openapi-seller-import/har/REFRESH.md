# Refresh a captured API without rebuilding its decisions

A new browser capture often records the same API in a different request order,
with different sample identifiers or a changed response. The original HAR review
belongs to its exact source bytes. Reusing its numeric group IDs against a later
capture can attach a decision to a different request.

The refresh workflow retains both original source editions, compares their
observations and prepares decisions for the new source. It continues the existing
HAR reviewer, immutable revision store, OpenAPI exporter and native merchant
package writer.

## Prepare the next capture

Choose the existing private HAR workspace and a saved, complete review revision.
Export the next HAR 1.2 capture from the same API and prepare a new private packet:

~~~sh
starforge openapi har refresh prepare \
  --workspace /private/api/previous-workspace \
  --revision PREVIOUS_REVIEW_SHA256 \
  --har /private/captures/next.har \
  --out /private/api/refresh-2026-10-12
~~~

From a source checkout, replace `starforge openapi har` with
`node stellar/scf-starforge-20261009/sf61-openapi-seller-import/har/cli.mjs`.

The command returns the packet directory, operation identity, previous and
candidate source hashes, review-page path, draft path and comparison summary.
Opening the packet verifies the retained archives with the original HAR
decoder, the selected previous revision and the generated comparison.

| Packet entry | Purpose |
| --- | --- |
| `previous/` | Original previous HAR workspace, source archive and all its saved review revisions |
| `candidate/` | Original native HAR workspace for the new capture and its subsequent saved reviews |
| `change-report.json` | Complete source comparison, matching decisions, old authored values and unselected observations |
| `draft.json` | Initial migrated decisions bound to the new source and previous approved revision |
| `review.html` | Self-contained original reviewer with the capture comparison above its existing controls |
| `refresh.json` | Stable operation identity, source/review lineage and retained file digests |

Both workspace directories use the existing HAR layout. They can be inspected
with the ordinary `har inspect` command and exported using its original APIs.
Packet directories are private (`0700`) and files are private (`0600`).

Preparation writes to a separate staging directory and publishes a complete
packet into an exclusively reserved destination. A completed retry with the same
destination, two source editions and previous revision returns that same packet.
A different request cannot overwrite it. A process interruption before publication
can leave an uncommitted reservation or staging directory; retain the original
captures and use a new destination if the packet cannot be reopened. The original
source and approved revision remain unchanged.

## Read the comparison and finish the original review

Open the returned `review.html` locally. Its embedded script, model and content
security policy come from the original offline HAR reviewer; it requires no server
or external resources.

The comparison lists each previously selected operation first, followed by the
new capture's additional observations. Expanding a changed operation shows the
previous and new values of each affected section:

- Captured request paths.
- Query names, repeated keys and observed presence.
- Credential locations and custom header names.
- Request media, combined observed shape and recording coverage.
- Response status, media, combined observed shape and recording coverage.

Exact method, origin and literal path match first. Numeric `group-1` and `entry-1`
values are local to their own captures. They are never treated as cross-capture
identities.

When an exact path is absent, a new observation can match one previously reviewed
path template with the same method and origin. For example, a new
`GET /items/b` observation can join the existing reviewed `GET /items/{id}`
operation that previously contained `/items/a`. New sample membership appears in
the comparison and reopens that operation's acknowledgment. A candidate matching
multiple reviewed templates remains unselected so the operator can assign it to
the intended route.

| Result | Initial candidate behavior |
| --- | --- |
| Same observed contract and captured paths | Preserve operation ID, authored examples, field decisions and acknowledgment |
| Changed observation | Preserve operation ID and authored values; reopen acknowledgment and initialize new fields as unresolved |
| Previously selected route absent from this capture | Retain its authored values in an unselected row for explicit remapping |
| New or ambiguous observation | Add an unselected original-review row with unresolved field decisions |

Changing only the number or order of equivalent observations does not reset an
unchanged route. Recorded schema unions are compared independently of how samples
were divided among groups. Differences describe these captures; they do not
declare that the provider removed an endpoint or changed its authoritative API
contract.

Use the original operation controls to inspect the new groups, resolve new query
or header decisions, author safe examples and acknowledge each changed selection.
A previous custom body/response schema remains authored. An observed schema is
rebuilt from the new capture after its review. Backend values remain environment
reference names. Prices and public seller addresses stay in the existing merchant
plan.

The draft retains previous decisions for removed fields in the comparison record;
removed fields are omitted from the active candidate decision maps. This lets the
operator inspect the old mapping while the native compiler uses only the selected
new source fields. New operation IDs are made unique without changing existing
reviewed IDs.

Choose **Validate and preview**, then **Download reviewed decisions**. Save that
download to the same packet:

~~~sh
starforge openapi har refresh save \
  --directory /private/api/refresh-2026-10-12 \
  --decisions /private/downloads/har-decisions.json
~~~

Saving uses the original `candidate/reviews/<SHA256>.json` writer. Equal saves
return the same revision. The revision keeps its exact candidate-source binding
and the previous-source/review lineage in `x-har-refresh`.

## Reopen, export and prepare the native merchant

Inspect the packet and all candidate saved revisions:

~~~sh
starforge openapi har refresh inspect \
  --directory /private/api/refresh-2026-10-12
~~~

Reopen a particular saved candidate decision in the comparison page:

~~~sh
starforge openapi har refresh review \
  --directory /private/api/refresh-2026-10-12 \
  --revision CANDIDATE_REVIEW_SHA256 \
  --out /private/api/reopened-refresh.html
~~~

Export the selected revision through the original source exporter:

~~~sh
starforge openapi har refresh export \
  --directory /private/api/refresh-2026-10-12 \
  --revision CANDIDATE_REVIEW_SHA256 \
  --out /private/api/reviewed-next-source
~~~

This creates the original `openapi.json`, `review.json` and output manifest.
`review.json` retains the refresh lineage and is covered by that manifest.
Load `openapi.json` into the existing [API merchant workspace](../workspace/README.md)
as the backend source. Review the separate public seller URL, route selections,
exact atomic prices and host-held backend references there.

An existing native merchant plan can enter the same package writer directly:

~~~sh
starforge openapi har refresh package \
  --directory /private/api/refresh-2026-10-12 \
  --revision CANDIDATE_REVIEW_SHA256 \
  --plan /private/api/merchant-plan.json \
  --parent /private/api/packages \
  --name captured-api-next
~~~

The original `saveHarMerchant` verifies that the plan selects exactly the reviewed
method/path operations and preserves each reviewed backend header reference.
The original `workspace/model.mjs::savePackage` then owns source compilation,
facade generation, pricing, upstream configuration and package creation. Existing
plans may need explicit updates when a route or required backend reference changes;
refresh does not silently edit the merchant's commercial configuration.

Stage the returned ordinary merchant package through the existing
[SF82 release workflow](../../sf82-seller-pilot/RELEASES.md). Compare it with the
serving release, operate the selected native runtime and keep the same buyer
request and receiving workflow for that release. Refresh does not start a listener
or execute a purchase.

## Move the complete operation or prepare another edition

Copy the entire packet to a new private receiving directory:

~~~sh
starforge openapi har refresh copy \
  --directory /private/api/refresh-2026-10-12 \
  --out /private/receiving/api-refresh
~~~

The original workspace copy implementation verifies and carries both exact HAR
archives and every saved review. The comparison, initial draft and offline page
retain their original bytes. The receiver can inspect, reopen, save another review,
export or package without the sender's paths.

To process another capture, use this packet's `candidate/` and the selected
candidate revision as the previous workspace/revision in the next `refresh prepare`.
Each packet retains its adjacent source pair, and the previous saved review keeps
any earlier refresh lineage. Keep older packets when the full multi-edition raw
capture history is needed; the workflow does not duplicate the entire history
into each new packet.

## Privacy and operational limits

The packet contains the exact two original private HAR archives. Keep it outside
source control and ordinary public handoffs. The comparison and page contain
captured path and field names plus operator-authored decisions; the original
decoder excludes captured credential values, query values and body values from
the review inventory. Review path names and authored examples before sharing
an exported source.

Original HAR limits remain 128 MiB and 100,000 captured entries per source.
Candidate decisions remain within the original 4 MiB review limit; comparison
records and generated offline pages are limited to 32 MiB. No extra runtime
dependencies, server process, registry entry, payment engine or package builder
are introduced. The maintained distribution's whole SF61 source selection carries
all refresh modules and this guide under its existing `openapi` command.

Source contracts and initial capture instructions remain in [README.md](README.md).
