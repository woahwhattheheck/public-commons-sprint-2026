# Continue a named World Bank customer programme

The World Bank tab is part of the original local Analysis browser. It uses the
same capability, database, sources, comparison engine, report definitions and
workbook history. Programme preparation and refresh call the maintained
WorldBankRecurring engine; they do not rerun the one-edition demonstration over
a customer's saved SQL.

## Open the customer's workspace

Start the original installed product with its adjacent Python package:

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python \
  --workspace /srv/customer/economic-analysis serve --open
~~~

The command returns its private launch-file location. The existing Analysis
serve command also includes the World Bank tab. The installed original core.py
is selected by the launcher. An explicit --worldbank-core is a local launch
configuration, and is never accepted from a browser request.

Use the same customer directory for subsequent editions. Close its existing
Analysis server before opening it from another command; the original workspace
lease remains authoritative.

## Define the programme

First receive the customer's existing complete Analysis workspace through the
original receiver, or prepare its first edition through the original product.
The programme uses an existing view, saved report and saved workbook. It does
not replace their definitions.

In World Bank, choose New programme. Supply a stable name, title, the three
existing customer selections, a source-name prefix and the actual comparison
keys. Save uses the displayed programme revision. Changing a definition creates
another programme revision while retaining earlier ones.

The source selector pages through complete retained World Bank document
revisions. Each entry displays the original handover's byte length and SHA-256,
source document identity, capture time and reviewed observation count. A file
path, partial API page or arbitrary browser upload cannot enter this selector.
Receive a candidate's original source document using the command workflow below
before choosing it.

## Receive the next original handover

Use the complete new World Bank handover.zip returned by the source export or
customer downloader. An Analysis workspace archive and a CSV by themselves are
different inputs. Keep the full handover and its returned byte count and SHA-256.

Close this customer's Analysis server before running the following commands.
The command and browser use the same workspace lease. Read the programme's
saved definition first:

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python \
  --workspace /srv/customer/economic-analysis show --name country_monitor
~~~

Retain its exact definition.view, definition.report, definition.workbook,
definition.keys and definition.prefix, together with the programme revision.
Select one new 32-character lowercase hexadecimal operation ID for this edition
and keep it throughout intake, programme preparation and refresh. In the example
below that ID is bd00f5b0c2bc4db28498d42f587fe84c; replace the example customer
names and comparison keys with those returned by show.

~~~sh
starforge worldbank-product analysis --python /srv/starforge/python/bin/python \
  recurring-review --handover /srv/customer/incoming/new-worldbank-handover.zip \
  --workspace /srv/customer/economic-analysis \
  --operation-id bd00f5b0c2bc4db28498d42f587fe84c \
  --view customer_observations --report customer_report --workbook customer_workbook \
  --keys '["source_id","country_id","country_iso3","indicator_id","period"]' \
  --prefix worldbank --resume
starforge worldbank-product programme --python /srv/starforge/python/bin/python \
  --workspace /srv/customer/economic-analysis sources --limit 100
~~~

The maintained recurring engine verifies the original handover through the
World Bank importer, preserves its original source/review and typed document,
and prepares a comparison against the selected customer definitions. This
intake leaves the customer's current view, saved SQL, report and workbook
unchanged. Its exact request and completed work remain available for continuation.

From sources, retain the matching handover SHA-256, source name and source
revision. The source name is the selected prefix plus the first twelve
characters of this operation ID: worldbank_bd00f5b0c2bc in this example. Use the
returned revision, rather than assuming it is always 1. If sources has
next_before, continue with --before using that exact cursor until the selected
source is found.

Prepare the named programme with the SAME operation ID, the programme revision
read above and that exact source name/revision. The Prepare request below shows
this continuation. The manager reopens the original recurring review and jobs;
it preserves the original handover bytes, source-engine selection, prefix and
customer identities. After preparation, continue through that programme's
review and publish actions. A different handover or deliberate later review
uses a new operation ID. If customer definitions changed during preparation,
review those current edits in a new intentional operation.

For a browser continuation, reopen programme serve after these command-line
operations close. The retained candidate appears in the source selector; the
original operation and its review appear in the programme history.

Prepare source review imports the selected original handover through the
original World Bank engine and compares its typed observations with the
programme's current view. This does not select the candidate for the customer
until the explicit refresh action.

## Review and refresh

Open the operation's complete comparison to inspect original values, row
membership, schema and source identities. The programme page also retains its
full recurring review, the exact digest, baseline revision, candidate version
and the selected customer report/workbook editions. Download review JSON for
the complete recorded context.

Enter the source-selection and workbook note, then choose Refresh reviewed
report and workbook. The original engine checks the customer definitions and
source selection, applies the reviewed comparison, runs the customer's saved
report and refreshes related workbook sheets. Unrelated sheets retain their
original saved sources.

If actual column changes require a choice, the page shows each affected
worksheet. Select the original column and position, heading, output type, null
handling and numeric precision. Duplicate source labels are disambiguated by
position. The complete column arrays go back to the original workbook refresh
review; they are not inferred from a display label. Existing committed source
selection and report results remain owned by this same operation.

## Recover the original request

Before a mutating browser request, its complete ID and payload are saved in the
browser's local action reminders. A network interruption leaves the exact
request visible. Continue exact request reuses it; Read operation reconciles
the original server record. Programme operation history is independently
retained in the workspace and can be paged after a cold browser reopen.

An interrupted or failed coordinator exposes Continue original operation.
That action takes the server's frozen prepare, publish or delivery request and
sets resume=true using the same ID. A new source review is a new intentional
operation, not an automatic retry.

Preparation and refresh use a separate coordinator only to sequence the
existing Analysis jobs. It does not occupy their single worker. Closing the
programme command drains that coordinator before the original Analysis
workspace closes its jobs and releases its lease.

## Complete delivery and independent receiving

The complete operation lists its actual retained files and hashes. Small files
use ordinary browser downloads; files above 64 MiB stream to disk through a
browser with direct file saving. The existing server verifies the original
file descriptor and SHA-256 before streaming.

A restored workspace retains the original report, workbook and programme
history. The complete delivery ZIP is not recursively embedded inside another
workspace backup. A workspace snapshot taken during delivery assembly can
retain that original operation as interrupted. The manager verifies its source
selection, report publication and workbook against the actual retained native
records and exposes an accepted edition only when those results are complete.

When Create portable delivery from this accepted edition is available, it
allocates a new delivery ID linked to those accepted results. It packages the
same immutable publication/workbook and the current workspace snapshot; it
does not select a source again, rerun a report or save a new workbook definition.
An interrupted original outer delivery stays incomplete in its own history.

Keep the resulting original workspace archive, workbook handover, source
comparison and delivery manifest together. Use the existing workspace and
WorkbookDelivery receivers to reopen them in a separate customer directory.

## Command-line operation

All named-programme commands use the same manager as the browser. Global
workspace/core options precede the subcommand:

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis list
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis sources
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  show --name country_monitor
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  history --name country_monitor
~~~

List returns next_before as the last programme name in ascending order.
Sources and per-programme history return row-number cursors in descending
order. Pass the exact returned cursor with --before; --limit accepts 1–100.

Save request:

~~~json
{
  "id": "71b5b27151f84d9eb402915d66e637d8",
  "expected_revision": 0,
  "definition": {
    "title": "Customer country monitoring",
    "view": "customer_observations",
    "report": "customer_report",
    "workbook": "customer_workbook",
    "keys": ["source_id", "country_id", "country_iso3", "indicator_id", "period"],
    "prefix": "worldbank"
  }
}
~~~

Use the actual existing names and comparison keys. IDs shown here are examples;
allocate one new ID for a new action and preserve it thereafter.

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  save --name country_monitor --request save-programme.json
~~~

Prepare request (use the actual programme and source revisions):

~~~json
{
  "id": "bd00f5b0c2bc4db28498d42f587fe84c",
  "expected_revision": 1,
  "source": {"name": "worldbank_bd00f5b0c2bc", "revision": 1},
  "resume": false
}
~~~

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  prepare --name country_monitor --request prepare.json
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  operation --name country_monitor --id bd00f5b0c2bc4db28498d42f587fe84c
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  review --name country_monitor --id bd00f5b0c2bc4db28498d42f587fe84c
~~~

Publish uses that same operation ID and the actual returned review_sha256:

~~~json
{
  "id": "bd00f5b0c2bc4db28498d42f587fe84c",
  "review_sha256": "ACTUAL_RETAINED_REVIEW_SHA256",
  "note": "Reviewed the original observation and source changes.",
  "columns": null,
  "resume": false
}
~~~

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  publish --name country_monitor --request publish.json
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  download --name country_monitor --id bd00f5b0c2bc4db28498d42f587fe84c \
  --filename WorldBank_Analysis_Delivery.zip --out /srv/customer/downloads/WorldBank_Analysis_Delivery.zip
~~~

The download publishes a complete verified file without replacing a differing
destination. Repeating it adopts the exact already-saved bytes.

For restored delivery, supply a new delivery ID and the accepted parent operation:

~~~json
{
  "id": "f58f74dd37f84c5f989a2b1635181221",
  "operation_id": "bd00f5b0c2bc4db28498d42f587fe84c",
  "resume": false
}
~~~

~~~sh
starforge worldbank-product programme --python /srv/starforge/python/bin/python --workspace /srv/customer/economic-analysis \
  reopen --name country_monitor --request reopen.json
~~~

The original analysis recurring-review, recurring-refresh, recurring-status and
recurring-receive commands remain available with their existing argument and
operation contracts. The named programme adds a saved customer selection and a
browser workflow around those original engines.

## Source and payment meaning

Exact original numeric tokens, nulls, included rows and exclusions remain in
the retained source. A changed edition must come from actual received source
bytes. Reusing the same observed edition establishes unchanged/retry behavior,
not a fabricated provider update.

This local customer refresh does not initiate payment or source acquisition.
Any paid purchase stays with its existing merchant release and original buyer
intent. Programme operation, source acquisition, workbook build and portable
delivery keep their distinct original identities.

## Provider metadata review

The retained review also compares complete provider metadata record identities and duplicate groups. Its counts are separate from observation counts. The screen shows whether the two editions use the same provider capture and selection, plus the exact changed source-selection and review fields. Expand the metadata detail or download the full review JSON to retain every original before/after record, numeric token, page identity and review choice. Excluding an observation from an unchanged capture is a review change; it is not represented as a provider update.
