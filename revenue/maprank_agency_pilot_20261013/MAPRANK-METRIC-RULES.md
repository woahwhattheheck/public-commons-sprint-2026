# Metric and comparison rules
These are proposed companion-desk semantics. Vendor aggregates remain preserved under their original labels and source. Source definitions are MR-CHECK and MR-AGENTS in the source register.

## Point states
Each expected point is one of: ranked, not_found, error, missing. Ranked has an observed positive integer rank. Not_found requires an actual completed source result saying absent; preserve any reported search depth. Error retains the source error. Missing means no received observation. Never map an error/missing point to zero, rank21 or a loss.

A complete scan has a received completed outcome for every expected unique point. An extra/duplicate point is an intake issue, not a reason to silently increase the denominator. Keep the original input available.

## Preserve and compute separately
Preserve provider average_rank, best_rank and top3coverage exactly, including nulls, precision, units and source text. The public contract does not define the treatment of absent/error points in the average. Never overwrite a provider average with a differently calculated one.

Local counters:
- planned_points: number of unique expected scope points.
- evaluated_points: ranked + explicit not_found outcomes.
- ranked_points: count of ranked outcomes.
- top3_points: ranked outcomes with rank1–3.
- top10_points: ranked outcomes with rank1–10.
- not_found_points, error_points and missing_points: separate counts.

Local complete-grid top3coverage =100*top3_points/planned_points only when every planned point was evaluated. Otherwise null, with completeness status. For partial data, optionally show100*top3_points/evaluated_points as “Top3among evaluated points,” carrying both numerator and denominator; never label it full-grid coverage.
Top10 follows the same rule.
Found-only mean =sum(observed ranked positions)/ranked_points, or null if none. Label “Mean of ranked points”; excluded not_found/error/missing counts stay visible.
Best observed rank =minimum ranked value, or null if none.
Round only display values; preserve source precision for exports and subsequent arithmetic.

## Comparability
Require the same target identity, exact keyword, grid definition and actual coordinates. Preserve spacing units. Same dimensions alone do not establish same geography. When either source lacks exact geometry, mark comparability “unconfirmed” with the missing fields. Do not invent coordinates from screenshots.

Coverage delta =followup_percent-baseline_percent, labeled percentage points. A larger positive coverage delta is improvement. Rank positions gained =baseline_rank-followup_rank for points ranked in both observations; a positive value means an improved numerical position. Found→not_found and not_found→found are separate transitions, without a guessed rank. Incomplete points remain separate.

Provider averages can be displayed side by side with source labels. Compute their delta only when their documented conventions match; otherwise retain the raw values and use eligible point-level observations.

## Budgets
Estimated credits per square grid =side*side per keyword, if all planned points are run. Planned cycle credits =sum(points*planned occurrences) over every location and keyword. The app quote and actual ledger remain authoritative. A displayed vendor “scan” can represent49credits; do not subtract one unit for any arbitrary grid. A geometry extent derived from coordinates or(side-1)*spacing must be labeled a local geometric calculation, not a vendor market-coverage promise.

## Decisions and missing inputs
A comparison with missing evidence can be saved and corrected. It cannot silently receive a completed-comparison badge. Acceptance refers to an exact revision and selected observations. A changed scope or supporting observation requires new review. No client-specific rank, keyword volume, lead count or financial outcome is prefilled from website examples.
