# Find applications and retain their setup

Open **Applications** in the original Runtime workspace. The saved library,
current tool catalog and setup drafts work with the same installed runtimes and
the existing Review, Save, Start, Open and Stop actions.

## Find saved work

**Find a saved application** searches its saved name, application type, command,
status and runtime location. All entered words must match the same application.
The Runtime and Status filters use the actual returned saved records. Results
show twelve applications per page and the complete matching count.

Filtering and changing pages retain the selected application, its current
operation, history and output. **Show selected application** clears the filters
and opens the page containing that same selection. **Clear filters** returns the
complete saved library. Select an application to inspect its original operation;
**Edit settings** opens its saved setup or the last retained draft for that
application.

The library keeps its search, filters and page in the current browser tab.
Refreshing reloads the real application status. A missing selected runtime stays
visible as a retained selection when its setup is open.

## Choose an original tool

Expand **Available application tools**. Search by the tool's name, purpose,
command or setup labels. Each result shows the original description, its command
and required setup fields. **Configure** opens a new setup for that tool and
retains any unfinished setup already on screen.

The catalog follows the current Applications response. Newly installed provider
entries appear on refresh. Review checks whether the chosen runtime includes the
selected original command and its source. Select a ready runtime and the actual
private state, source package and environment references required by that tool.

## Keep unfinished setup

Typing retains the display name, selected runtime and original named fields in
this tab's setup storage. Raw text, empty fields, checkbox values, JSON formatting
and numeric input strings are retained before the application's normal review
normalization.

**New application** creates another setup context. Changing the tool retains the
previous tool's fields within that context. **Retained setup drafts in this tab**
lists the unfinished setups; choose one and select **Resume selected draft**.
Opening another saved application, moving to another view or refreshing the tab
keeps those drafts. Different runtime workspaces use separate draft namespaces.

**Inspect the complete retained setup** shows all original draft fields and its
saved application revision. **Download current draft** exports that complete JSON
to the operator's machine. **Discard current draft** discards only the selected
draft and reloads the current saved application, or a fresh setup when creating
an application. Other retained setups remain available.

Setup drafts use browser session storage. Download a draft before permanently
closing its tab when it must be kept independently. If the browser refuses a
storage write, the interface states that the current fields remain in the page
and offers the same complete download.

## Review a changed saved application

A setup draft remains attached to the saved application revision from which it
was opened. When another operator saves a newer revision, choose between:

- **Keep my fields with current saved revision**: retain the entered fields and
  review their current source, runtime and data bindings.
- **Load current saved settings**: replace the selected draft with the latest
  saved setup.

When a provider removes an old setup field, its retained value stays visible in
the complete draft. Download or inspect it, then use **Use the current tool
fields** to explicitly remove those obsolete fields from the selected setup.
A temporarily unavailable application or tool keeps its full draft available
for inspection and download.

## Save and continue the original operation

Select **Review application** to inspect the original command, runtime, input
locations and managed release. Saving uses the exact returned review and original
application identity. If the form changes while review is running, review the
current fields again. If newer typing arrives while the save is completing, the
saved result and the newer draft both remain available.

The existing **Recover last application request** resumes a missing save/start
response with its original request ID and body. A recovered save clears only the
matching setup snapshot. A later draft is retained. The existing server's explicit
pre-write revision, running-application and changed-input rejections retain their
returned outcome and reopen setup for a new review.

After saving, use the existing **Review start**, **Start**, **Open application**
and **Stop application** controls. Provider operation, payment, terminal input,
current workers, data directories, backups and customer delivery remain in their
original applications. Python workspaces and prepared OpenAPI connections feed
their selected fields into this same retained setup.

## Integration and original receiving

The browser modules are `public/application-library.mjs` and
`public/application-drafts.mjs`. The existing `public/applications.mjs` supplies
the current state, selected runtime, original review and retained request actions.
The original server serves both modules through its existing same-origin asset
map. No additional package dependency is required.

Continue the existing Applications receiving operation with its original runtime,
application IDs and customer state. Exercise the real catalog's later pages,
saved name/runtime/status filters and selected application's retained history.
Keep an unfinished setup through a tool change, New application, refresh and
Python/OpenAPI preparation. Use two original browser pages to observe a saved
revision change, then retain or reload its fields and complete the existing save,
start, open, stop and reopen sequence. Reconcile a lost save response through the
same request and confirm that only its matching draft clears. Retain the current
grayscale desktop and 390-pixel mobile views with that operation's other outputs.
