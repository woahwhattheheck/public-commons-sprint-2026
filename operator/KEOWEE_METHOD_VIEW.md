# Keowee source-method results in Conservation

The existing Published point criteria disclosure now shows the retained source observations and literal method intervals in readable form. Study selection, inventory actions, portfolio selection, optimizer controls and paired experiments continue through their existing paths.

## Receiving source

The additive browser module is `operator/web/keowee-method-view.mjs`. The original `operator/web/conservation.mjs` composes it through exactly two changes: one module import and one delegation from its existing `pointCriteria(candidate)` function.

The asset-only descriptor `operator/extensions/keowee-method-view.json` registers the new module through the current extension registry and the host's existing `extensions.web_assets` allowlist. Include both new files in the installation and reload the operator so it discovers the descriptor. The descriptor adds its static asset through the maintained registry.

The merged composition uses the 124,883-byte browser from main commit `0a0908b5203595599368c1264a7dc20c76c18a68`, SHA256 `8ba403d5f1e7c7270066f2426ca962a8baf70b36996e74d017f1109d0e113071`, Git blob `d24e62b5d3126dc6676c6b05d3d89006dd796e94`. Both original guarded edits match exactly once; the other current controls remain intact. The resulting browser is 122,162 bytes, SHA256 `58fd78e525f32e364ea5047186d7388d6d34a9ca464c2563f7cfee72b4fea532`. The accompanying source ledger preserves both exact replacements and the complete successor body. Apply these replacements to a newer browser edition when its unrelated controls have advanced.

Ownership was coordinated in the existing engineering thread with E7A1, ES-EXP-2319, 47DB and OP12:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791860811225169?thread_ts=1791724121.853269

## What the operator sees

- Original scalar values preserve their precision, including values near a printed class boundary.
- Numeric source observations include their recorded units.
- Overlapping intervals show every matching class and attainable point contribution.
- A gap in the printed table shows the retained alternatives. Discrete point sets keep their gaps: 0 and 2 remain “0, 2”.
- The category summary shows attainable total contributions and potential priorities with the existing practice prerequisite.
- Original field names, exact provider class values, TPGT-to-TGPT adaptation, feature IDs, unit conversions and declared current-grid interpretation are available beside their observations.
- Method references use the printed page numbers and the original source URL.
- Retained profile identity and complete native binding records remain available in expandable source details.

The view uses the current `cons-disclosure`, `cons-table`, `cons-definitions` and `cons-metric-note` styles. It adds no colors, navigation state or action handlers. All provider text is escaped; source links use HTTP or HTTPS. Older saved point records render through the same function.

## Data contract

The existing `candidate.point_score`, `candidate.score_components`, known/possible values, scalar metrics and legacy references remain supported. The view also consumes the additive fields from native integration v1.0.1, F0C8KFC45GD:

- `score_options` and `priority_options`;
- `upstate.keowee-classification/v1` scalar, unit, state, matched classes and source references;
- `upstate.keowee-observations/v1` original typed observations;
- retained source profile identity and original metric-source bindings.

The module renders existing results. It does not calculate practice scores or select parcels. Its exported functions can be reused by the receiving operator’s source-result preview:

```js
import { renderKeoweePointCriteria } from "./keowee-method-view.mjs";
const html = renderKeoweePointCriteria(candidate);
```

## Focused receiving check

The exact module executed in V8 against the retained original Greenwood parcel’s JavaScript source result and the original printed nitrogen overlap example. The original 1.49152006731301-acre observation and geometry field survive presentation. The overlap value 0.03246 displays both low and medium with exactly 0 and 2 attainable points. Raw profile identity no longer fills the scalar table cell, and provider field text is escaped.

The joined original operator source was parsed with its module URL supplied. The existing native receiving operation is main Eco post 1791857188.502629; it receives the actual workspace import, study, saved selection and reopen result through `source_tools/keowee_profile_receiving.py`. Its rendered candidate view uses this same module when the current browser source is adopted.
