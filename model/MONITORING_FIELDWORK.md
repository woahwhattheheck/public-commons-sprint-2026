# Carry a Monitoring campaign into fieldwork

Open **Monitoring design**, choose the saved campaign in **Campaign fieldwork**,
and select **Update fieldwork from this revision**. The existing native task queue
retains that exact campaign revision. When it completes, **Open saved fieldwork**
opens its saved Implementation revision. The original source package is available
from both the completed task and the plan's managed attachments.

The same campaign always selects the same Implementation plan. A later campaign
revision updates the generated fields that still match the previous source
edition. Local fieldwork edits are preserved and the saved result identifies each
incoming change that was kept for review. Every received campaign edition remains
a frozen source link, with its complete native source package.

## Original data carried through

- Each selected catchment remains a search area until the saved campaign binds an
  actual source station. Coordinates come from that station's original WGS84 point.
- Visits retain original dates, local start and finish times, rounds and crews.
  Local wall times stay local; the adapter does not assign a timezone.
- The associated task keeps its planned start date and original crew. Its duration
  is unset because the Monitoring calendar expresses visit minutes, while the
  Implementation task scheduler uses whole working days.
- A collected event supplies its original sample ID and actual timestamp. Sample
  activities retain the complete original values object and original event ID.
  Lab measurements use the existing Implementation lab import mapping.
- The original design's total USD cents become a planning budget line. Its
  breakdown and scope stay attached to that line.
- Source revisions, design, network, field history, original vector sources and
  their companions are retained in the managed monitoring field package.

Monitoring missed visits remain open fieldwork with the original missed status
and note. Cancelled visits retain cancellation; completed visits require the
original collected-event timestamp. An earlier sample at a different station
retains its own source-backed historical visit and coordinates.

## Receiving a revised campaign

The importer compares each generated field with its previously imported value.
An unchanged generated field follows the new source edition. A field edited in
Implementation remains as edited, and the incoming value appears in
`monitoring_origin.preserved_fieldwork_changes` alongside the new frozen source.

Unmodified, still-planned generated visits and tasks removed by a revised design
move into `monitoring_superseded_rows`. Actual samples, their referenced visits,
and edited work remain retained. Historical monitoring-plan memberships keep
their original site sets. The current design's budget replaces its prior
generated budget when that amount remains unedited.

An already received source revision reuses the saved plan and its attachment.
A historical campaign edition can be attached after a newer one without moving
the current generated fieldwork backwards. Replaying a task after an interrupted
attachment resumes from the saved source selection.

## Native integration

The registered queued action is `monitoring.campaign.fieldwork`, with the existing
workspace key and payload:

```json
{
  "campaign_id": "<original campaign ID>",
  "expected_revision_id": "<selected original revision ID>",
  "operation_id": "<retained client operation ID>"
}
```

The original Monitoring transport retains the operation ID across a lost reply.
The result identifies the saved Implementation plan/revision, current source
edition, counts, preserved edits and managed source attachment. The regular task
view links to `implementation_plans`; the registered desk uses
`openSavedPlan({workspace_key, plan_id, revision})`.

The complete native Implementation report and Project transfer workflows then
carry this same plan, revision history, attached sources and retained reports
through independent reopening. Existing Monitoring design, observed-context,
source-network and lab-import components continue through their original APIs.

Generated visit and task identities include their original design ID. A changed
design retains collected samples against their original calendar, while its new
planned work uses the new saved design. Site identities include the original
network edition, preserving historical station coordinates after a source change.

## Linked fieldwork edits

Campaign updates preserve deleted visits and sites together with their dependent incoming tasks and samples. Changes that cannot join the retained fieldwork graph are retained in `preserved_fieldwork_changes` and the attached source package. Existing sample sites protect their original visit, and monitoring-plan membership keeps local members while admitting all retained visit sites. The packet contains every original design, network and publisher source referenced by its selected campaign history.
