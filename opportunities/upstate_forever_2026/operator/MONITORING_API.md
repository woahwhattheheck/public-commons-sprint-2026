# Monitoring API — 1.2

## Current original operator

Writes go through the original `POST /api/actions` queue:

```json
{"workspace":"<native workspace key>","action":"monitoring.design","payload":{"network_id":"<retained ID>","configuration":{}},"operation_id":"<stable request identity>"}
```

The response is the native task record (HTTP 202). Follow `/api/task?id=<id>` to
completion or use the existing task resume control. `task.result` carries the
complete action result. `monitoring.export` receives a native file ticket through
the original task decorator; its public result contains `download_url`, byte
count and SHA256 rather than a private filesystem path.

Reads use `GET /api/monitoring?workspace=<key>&action=<command>&payload=<JSON>`
through the existing authorization check. Read commands are `capabilities`,
`source.catalog`, `list`, `get`, `frontier.progress`, `campaign.list`,
`campaign.get` and `campaign.history`. Other listed commands are queued writes.
Original errors remain standard native `ValueError`/input errors. No second
HTTP listener, authentication service or job controller is introduced.

The legacy package-operator adapter accepts the older
`{"action":"monitoring.<command>","params":{}}` envelope at `/api/action`.

## Shared extension registry

`operator/extensions/monitoring.json` uses the actual
`upstate.operator-extension/v1` contract, descriptor version `1.2.0`.
Its module is `monitoring_native`, with these existing-host bindings:

- invoke: `perform(operator, task)` for all seven namespaced writes;
- GET `/api/monitoring`: `read_registered(operator, workspace_key, payload)`;
- task files: `decorate_task(operator, task)`;
- native receiving: `verify_workspace(workspace)`.

The browser factory is `attachMonitoring({getState, api, endpoint, showTask,
toast})`, with `mount`, `update` and `detach` lifecycle methods. The original
host remains responsible for authorization, queue execution, task recovery,
file-ticket serving and workspace identity. No custom policy exemption is added.

`campaign.get.calendar` contains `station_id` (the preserved recorded binding
when a non-note field event exists) and `planned_station_id` (the current campaign
binding). A station change affects future unsampled visits, not earlier samples.

## Commands

| Command | Required parameters | Additional parameters/result |
|---|---|---|
| `capabilities` | none | All command names and source/receiving contracts. |
| `source.catalog` | none | Native source editions and every retained vector entry. |
| `network.import` | `domain_collection_id`, `domain_source_id` | `station_collection_id`, `station_source_id`, `domain_layer`, `station_layer`, `id_field`, `downstream_field`, `stratum_field`, `priority_field`, `station_id_field`, `station_huc_field`, `station_outlet_field`, `station_assignments`, `outlet_values`, `title`. Returns full saved network. |
| `list` | `kind` | `kind`: networks/plans/frontiers/revisions/events. `limit` 1–500, `cursor`, `snapshot`. Follow every `next_cursor`; a changed snapshot requests a restart instead of mixing pages. |
| `get` | `kind`, `record_id` | Complete original immutable record with verified record identity. |
| `design` | `network_id`, `configuration` | Optional `title`; full saved design including infeasibility diagnostics. |
| `frontier` | `network_id`, `configuration`, `budgets` | Optional `title`. Complete comparison and saved plan IDs. Identical requests resume interrupted work. |
| `frontier.progress` | `network_id`, `configuration`, `budgets` | Same optional `title`; completed count and every completed plan ID. |
| `campaign.create` | `plan_id`, `title`, `operation_id` | First revision and stable campaign ID. |
| `campaign.list` | none | All current campaign heads. |
| `campaign.get` | `campaign_id` | Current revision, full plan/calendar and all retained events. |
| `campaign.revise` | `campaign_id`, `expected_revision_id`, `operation_id` | Optional new `plan_id`, `title`, `note`, `site_bindings` object mapping selected catchment ID → actual source station ID. |
| `campaign.event` | `campaign_id`, `expected_revision_id`, `operation_id`, `visit_key`, `status`, `occurred_at` | `sample_id` required for collection; optional `note`, JSON `values`. Returns new campaign revision. |
| `campaign.history` | `campaign_id` | Complete oldest-to-newest immutable revision history. |
| `export` | Exactly one `campaign_id` or `plan_id` | `format`: bundle/html/workspace. Returns native task file ticket, byte count and SHA256. Direct CLI returns the local output path. |

## Configuration

Use actual retained source IDs and operator-entered costs. The following is a
schema illustration, not an asserted client budget or source dataset:

```json
{
  "coverage_mode": "local",
  "currency": "USD",
  "budget": "2500.00",
  "program_overhead": "200.00",
  "default_cost": {
    "setup": "50.00",
    "per_visit": "40.00",
    "basis": "operator planning estimate"
  },
  "site_costs": {},
  "max_sites": 10,
  "min_sites": 0,
  "required_ids": [],
  "excluded_ids": [],
  "existing_station_ids": [],
  "minimum_by_stratum": {},
  "minimum_network_separation": 0,
  "incompatible_pairs": [],
  "time_limit_seconds": 120,
  "relative_gap": 0,
  "calendar": {
    "start_date": "2026-11-02",
    "end_date": "2027-04-30",
    "interval_days": 28,
    "round_window_days": 7,
    "weekdays": [0, 1, 2, 3, 4],
    "months": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    "blackout_dates": [],
    "crews": 1,
    "crew_day_minutes": 480,
    "day_start": "08:00",
    "visit_minutes": 60,
    "travel_buffer_minutes": 30
  }
}
```

`minimum_network_separation=1` prohibits selecting two catchments connected by
one directed downstream edge. `2` also prohibits pairs two downstream edges
apart. It is not a minimum kilometre distance or an adjacency-buffer rule.

`site_costs` provides complete `setup`/`per_visit` overrides for individual source
catchments. Every catchment requires explicit cost inputs or the stated default.
Calendar windows may not overlap, and each retained round needs an eligible date.
Seasonal month filtering operates on the nominal round date; only eligible dates
inside the declared season are scheduled. Weeks use Python weekday numbering:
Monday 0 through Sunday 6.

## Integration with the original durable job controller

The original job controller invokes `model.monitoring_actions.invoke(workspace,
"frontier", params)` or the CLI in its existing worker process. The implementation
owns no process supervisor, listening socket or background timer. `frontier`
checkpoints each full budget result into native records; a restart with the same
inputs reuses them. `frontier.progress` is read-only and uses the same job identity.

Campaign creation and edits require stable client operation IDs for retry safety.
The browser starts a new ID for each completed distinct action and retains the
original pending request across a lost-response retry; API/CLI callers should reuse
the previous ID and exact payload when retrying a lost response.


## Current native integration 1.2.1

The registered seven writes and original read surface are unchanged. `monitoring.export` additionally accepts `expected_revision_id` for a campaign export; the current interface sends the selected revision. The provider retains the original task's export selection and completed result under its existing output root. Full receiving verifies native records and source bodies without creating collections or materializing source views. The complete operating and receiving course is `integrations/monitoring/RECEIVING.md`.
