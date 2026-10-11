# Retained ShiftLoom workspace API

Root UI ownership: workspace/public/index.html, app.mjs, style.css and WORKFLOW.md. Revenue agent owns app.py, store/source normalization, the original planner seam, engine bridge, native source intake and examples. All source belongs under amazon-shiftloom-2026/workspace/ in public Commons.

Run: python3 app.py --db /ABS/PRIVATE/coverage.sqlite --port 8802. Python 3.10+ and Node 22.16+. Loopback server serves public/ and writes only its selected SQLite workspace. A meta tag named workspace-token receives __SESSION_TOKEN__; write requests send X-Workspace-Token. JSON errors are {error,message,current_revision?}. Writes include expected_revision from GET /api/state, and return {revision,...}. Reload state after mutation; a stale revision returns409.

## Source roles

CSV and flat/nested JSON retain exact bytes and original rows. A dataset has one role. JSON imports accept root_path (dot path into the payload); nested object fields appear as dotted headers. Mapping is canonical_field→source_header; constants may supply an explicitly chosen value instead of a header. Optional value_maps map source tokens to canonical tokens. Saving a mapping confirms/selects that dataset for its role. Old source bytes and mapping snapshots remain attached to already-built boards.

| Role | Fields |
| --- | --- |
| volunteers | id, name, active, weekly_limit |
| shifts | id, label, start, end, capacity, reserved, required, target (optional), need_id (optional) |
| assignments | id, shift_id, volunteer_id, status; team_id (optional) |
| availability | volunteer_id, shift_id, available, eligible, preferred (optional), eligibility_note (optional), observed_at (optional) |
| qualifications | volunteer_id, qualification_id, status, expires (optional), valid_from (optional), label (optional) |

Canonical booleans: true/false; canonical assignment status: confirmed/excluded; canonical qualification status: active/pending/inactive/expired/rejected/resubmit. Other actual tokens need an explicit value map. Required qualification IDs are separated with |. Weekly_limit, capacity and reserved are nonnegative integers. Zero reserved means the coordinator has accounted for every occupied slot through named assignments. Dates accept full ISO values; offset-free values use settings.timezone and an optional source datetime_format. Ambiguous/nonexistent local timestamps need an explicit offset. Expiration dates retain the original date and use the visible coordinator-selected date policy.

Every role is required for a frozen board; a zero-row qualification file with a header is valid when every shift explicitly requires none. Missing affirmative availability or eligibility keeps a new candidate out of that shift. The original committed roster remains inspectable. Unresolved identities, duplicate records, invalid capacity/intervals and unconfigured policies are shown as row findings before planning.

## GET routes

- GET /api/state → {revision,settings,roles:[{key,label,fields:[{key,label,required,help}]}],datasets:[dataset_summary],selection:{role:dataset_id},boards:[board_summary],active_board_id,source_links}. Settings: {organization,label,timezone,week_start,source_observed_at,expiry_date_inclusive,cohort_complete,notes}. week_start is one explicitly selected seven-day period. Included context shifts can fall outside that period for overlap checks; only starts in the period count toward its weekly limit. target=false keeps a context shift off the planning queue.
- GET /api/datasets/:id?offset=0&limit=50 → {dataset,rows:[{row_index,original,canonical,overrides}],total,offset,limit,errors}. Dataset includes headers, mapping, constants, value_maps, datetime_format, row_count, original SHA/bytes and capture metadata.
- GET /api/datasets/:id/raw → exact original file download.
- GET /api/boards/:id → {board,state,coverage,issues,plans,decisions,source_inventory,continuity}. state contains original planner volunteers/shifts/unavailable and revision. Shift objects additionally have reservedSlots, target, countsTowardLimit and source_refs. Volunteers include active, eligibility by shift, qualificationWindows and source_refs. Coverage rows have id,label,start,end,capacity,named,reserved,gap,target.
- GET /api/boards/:id/roster?offset=0&limit=50&query= → {rows,total,offset,limit}; each row contains its exact current assignments, eligibility/availability and qualification source references.
- GET /api/plans/:id → {plan,proposal,candidates,prior_review,source_inventory}. proposal is the actual original engine output (ok,message,chosen,rejected,changes,trace,candidateReview,originalRevision). candidates enrich those original reasons with exact source rows, qualifications, availability and existing bookings. plan has board_id,board_revision,intent,status,label,review,created_at,prior_plan_id.
- GET /api/boards/:id/handoff → ZIP of selected original inputs, frozen mappings/settings, original/current state, plans/decisions, source-linked roster/changes, review HTML and manifest.
- GET /api/backup → consistent complete SQLite backup for reopening with --db.

## Writes

- POST /api/settings {expected_revision,settings}; replaces the named settings keys after validation. Save explicit organization/timezone/week/source time/cohort declaration before building a board.
- POST /api/datasets {expected_revision,role,name,format:'csv'|'json',content_b64?,text?,root_path?,source_url?}; returns dataset_id and preview. The UI reads selected file as ArrayBuffer and sends content_b64 to preserve its exact original bytes; text is supported for pasted content. Dataset exists for inspection before confirmation.
- POST /api/datasets/:id/mapping {expected_revision,mapping,constants,value_maps,datetime_format?}; returns confirmed dataset_id. Render field selection with a constant alternative, and a value-map editor for actual categorical source tokens.
- POST /api/datasets/:id/overrides {expected_revision,actor,note,rows:[{row_index,fields:{canonical_field:value}}]}; retains coordinator-authored input values beside original bytes. Useful for per-person weekly limits or exact per-shift required qualifications/reserved capacity. Old boards retain their frozen prior values. Show original row and explicit overrides together.
- POST /api/select-dataset {expected_revision,dataset_id}; reuses a previously confirmed input.
- POST /api/boards {expected_revision,label,parent_board_id?}; freezes the current five-role selection/settings, builds original planner state and row findings, and selects that board. Build always retains a reviewable result; planning requires resolution of blocking source findings. Corrected source intake followed by parent_board_id creates a new board with exact source/assignment/eligibility differences and original plan references.
- POST /api/select-board {expected_revision,board_id}; selects retained board for review.
- POST /api/boards/:id/plans {expected_revision,shift_id,absent_volunteer_id?,excluded_volunteer_id?,label?,prior_plan_id?}; calls original proposeCoverageIntent on that exact board. It creates a retained proposal even when coverage is infeasible, preserving each candidate reason. Original full-coverage and workload/preference ranking remain the engine.
- POST /api/plans/:id/review {expected_revision,decision:'APPROVE'|'REJECT',actor,note,confirmed_current_source:true}; approval applies the exact current original proposal to the same board, retains before/after state and named decision, and advances its revision. Stale proposals and input selection mismatch return409. A fresh plan against a corrected board can link prior_plan_id; prior decisions are displayed for reference and require a new current review.
- POST /api/boards/:id/undo {expected_revision,decision_id,actor,note}; reverses only that board's most recent approval, retains the reversal and advances the revision. Earlier proposals stay stale.

## Native Get Connected input

POST /api/native-snapshot {expected_revision,name,content_b64?,text?} accepts a retained getconnected.coverage-snapshot.v1 JSON bundle with domain_id,captured_at,needs:[native needObject],responses:[native responseObject],users:[native userObject],qualifications:[{user_id,data:[native userQualificationsObject]}]. It creates four original-role source datasets with native field projections and original source paths; coordinator availability is the fifth source. The UI presents the resulting datasets for confirmation and explicit requirement, weekly-limit and reservation mapping. Native custom response answers remain source data until the coordinator supplies their actual interpretation.

The maintained OpenAPI is https://api.galaxydigital.com/docs/api.yml?v=1.9.2 . Exact source evidence and native field/pagination distinctions are documented in SOURCE_CONTRACT.md. Official source data has string IDs, separate need and shift IDs, qualification expiry dates and unconstrained response status text. Current export columns are user-selected, so the interface must inspect actual headers.

The same native-snapshot route accepts the command's retained requests array. Each record has method=GET, url, status=200, captured_at, body_b64 and sha256; capture.api_base identifies one documented region. The importer derives all native records from those exact response bytes, checks request IDs and domain scope, preserves per-user qualification request identity, and exposes the original request index/URL/response SHA/decoded JSON pointer in projected source rows. GET /api/native-sources/:id/raw downloads the complete original capture. See capture_getconnected.py and README.md for actual selected-ID collection and resume commands.

Plan status values are DRAFT, INFEASIBLE, APPROVED, REJECTED and UNDONE. Board detail also exposes source_matches_current and latest_undoable_decision_id. Candidate source_rows hold the original/canonical/coordinator values used by that exact planning-state snapshot. Selected handoffs include ancestor boards, original source versions, full prior plans and decisions under lineage/; the complete SQLite backup reopens every retained board.

## Interface flow

1. Configure site/timezone/planning period and declare roster scope.
2. Upload five actual report roles or a native bundle plus coordinator availability; confirm header/status mappings and coordinator inputs.
3. Freeze a board; inspect source findings and exact rows, current occupied/reserved places and volunteer roster.
4. Select any target shift by actual ID; request fill or a named absence/replacement and optional single exclusion.
5. Review the actual candidate reasons and source rows; approve/reject with named coordinator and note. Undo the latest approval when needed.
6. Import corrected exports, build a successor board, compare changed assignments/source and replan the same scenario with its prior review beside it.
7. Export the complete selected handoff, download the full workspace backup, restart the original command and reopen its retained history.

Use clean industrial layout, neutral monochrome, keyboard-operable controls, visible exact case/shift/user IDs, clear error messages and paged source/roster tables. API keeps raw source private; use textContent for every imported string.

