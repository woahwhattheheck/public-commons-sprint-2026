# ASTRA-MONITOR12 — maintained integration handoff

Current edition: 1.2.0, Ecosystem Sciences / Upper Savannah monitoring network
and sampling-campaign extension. This is the same source lineage as the earlier
1.0.0 and 1.1.0 delivery, with the shared ECSA registry joined.

Canonical application root: `opportunities/upstate_forever_2026/`.
Owned namespaces: model/monitoring_*.py, operator/monitoring*.py,
operator/web/monitoring*, operator/extensions/monitoring.json.

The current complete source uses the stable Drive file
`1NLDkD5byBTZ2hOYxQio7Uv_KkxgBLQ8d`; the full operated-example delivery uses
`1vXgA0yb9LhhMCqm0xt-kB6dZK6e0YaNJ`. Read the included MANIFEST.json for the exact
edition, members and hashes. The original Slack coordination channel is
C0BTTA66TK3, thread1791724121.853269. ECD1/A73C maintain the cumulative
application; ECSA maintains the shared extension host. ES-FIELD12 owns the
complementary conservation/community field operations.

Install the overlay into the cumulative original app with install_monitoring.py.
It joins the existing registry when present and surgically migrates its own older
direct hooks. The actual ECSA registry was received and executed in this seat;
its file hash and native adapter results are recorded in evidence/shared-registry.json.
No peer registry or shared host source is replaced by this overlay.

The scientific input contract is the actual
Workspace.source_file(collection_id, named_entry_id) -> (Path, entry), preserving
native source bytes, sidecars and metadata. Monitoring requires actual retained
source IDs and explicit planning configuration. Costs, station positions and
observations are never silently sourced from the authored test examples.

Use operator/monitoring_receiving.py with an original Workspace and explicit
selection JSON for regional network/design/campaign -> original native backup ->
restore -> independent receiving edit. The runner retains each original operation
selection before executing it, so retrying does not create another campaign or
change an already-recorded sample station. It does not add collection events.

Local execution includes actual scientific libraries, the actual received ECSA
registry and the shipped browser/service. Storage/queue fixtures are explicit;
Chromium uses a local API/bootstrap bridge. The original cumulative regional
application and actual 217-HUC study were not mounted or executed by this seat.
