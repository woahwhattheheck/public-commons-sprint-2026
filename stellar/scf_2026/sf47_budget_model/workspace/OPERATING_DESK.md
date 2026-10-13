# Grant Operations operating desk

The operating desk groups the original Grant Operations sections and adds a
case finder. It uses the same current case, child editors, source downloads and
versioned commands as the existing workspace.

## Use the workspace

Open **Delivery and cash operations** and choose a retained case. The left
navigation groups its sections into Planning and resources, People and work,
Cash and accounts, Customers and delivery, and Review and results. On narrow
screens, **Browse sections** opens the same grouped navigation above the
current section.

The original section labels and identifiers come from the host's complete
section list. New sections remain visible in Other sections until they receive
a specific group. The original editors are mounted through their existing
host integration. Your operator role determines the available sections and
record actions; the finder follows the same section visibility and original
record permissions.

Use **Pin** beside frequently used sections. Pinned sections appear first.
Recent sections follow, and each retained case remembers its own active
section, pins and recent visits. These preferences stay in the current browser
session. Moving between sections continues to use each original child desk's
retained draft and original-request recovery.

## Find a section or saved case record

Select **Find in case**, or press **Ctrl+K** / **Command+K** while focus is inside
Operations. Search by name, reference or saved text. Search ignores letter case
and accents, and every entered term must appear in the indexed entry. A full
original identifier ranks ahead of a partial name match.

Choose a result type or section to narrow the results. Every match contributes
to the count; the result list pages through the complete matching set. Search
covers:

- All sections available to your role in the current host.
- Native contributors, recorded work, supplier invoices, cash movements,
  issuer events, deployments, purchase observations and delivery outcomes.
- Retained source metadata, including original filenames, references and
  SHA-256 identities.
- The installation, work-intake, forecast, portfolio, amendment and review
  summaries returned with the current case.

The finder uses the complete supplied case response for the sections available
to your role. It searches retained source metadata and saved summary text; it does not decode attached file bytes.
The search dialog's **Search coverage** panel shows the exact indexed populations
for your operator view. Download a retained original source or open its existing
section for its full content.

Selecting a section opens that original desk. Selecting a record opens its
read-only detail, with original field values and links to other indexed case
references. Amount strings retain their original precision. No currency
conversion or business-status inference occurs in the finder. Long original
value lists, including statement row mappings, page through every value
without replacing the original array.

**Open original editor** opens the existing editor for an eligible native
record in an open case when your role permits that original record action. Cash changes continue through Cash / issuer and its
original correction flow. **Download original source** uses the existing
case-scoped byte endpoint. Saved review downloads use the existing complete
review endpoint. Saved forecast and portfolio results open the selected
original record in their existing desks. Before opening a saved forecast, any open
forecast inputs are retained in a complete downloadable file.

## Keyboard and focus

The case finder is a native modal dialog. Escape closes it and returns focus
to the control that opened it. Arrow Down or Enter from the query field moves
to the first result. Tab visits the filters, complete result controls and page
buttons. After choosing a section, focus moves to that section's content
region. The shortcut leaves an already-open child editor dialog in control.

Busy handling is shared with the host. Opening a different section disposes
the navigation view's event listeners while the existing child desk retains
its own inputs and original request. The navigation state contains preferences
and search text; it does not become a second store for case records or commands.

## Source integration

- **operations_navigation.mjs** contains section metadata, navigation preference
  normalization and the pure saved-case search model.
- **operations_navigation_ui.mjs** renders the grouped navigation and case
  finder, including read-only original details and existing host actions.
- **operations_navigation.css** provides the neutral responsive layout.
- **operations.mjs** supplies the current complete section list and case,
  scopes preferences to each case, and joins the original editors/downloads.
- **operations.css**, the existing static route registration, both managed
  launch lists and the Grant Operations distribution selection carry the
  installed files.

The model can also consume a complete saved case response in a native caller:

~~~js
import {
  defineSections, buildCaseIndex, searchCaseIndex,
} from './operations_navigation.mjs';

const sections = defineSections([
  ['overview', 'Plan / actual'],
  ['cash', 'Cash / issuer'],
  ['statements', 'Account statements'],
  ['sources', 'Sources'],
]);
const index = buildCaseIndex(originalCaseResponse, sections);
const result = searchCaseIndex(index, {
  query: 'original-bank-reference',
  kind: 'record',
  page: 0,
  pageSize: 25,
});
~~~

The model preserves the original entry object and identifier. **result.total**
counts the complete matching set; **result.from**, **result.to**, **result.page**
and **result.pages** describe the selected page. Attached base64 content is
excluded from text indexing.

See the [Grant Operations operating guide](../../../../products/grant-operations/OPERATING.md)
for the full planning, delivery, cash, customer receiving and review workflows.
