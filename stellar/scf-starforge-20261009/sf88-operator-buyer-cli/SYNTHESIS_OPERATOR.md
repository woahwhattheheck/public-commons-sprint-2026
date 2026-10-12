# Evidence synthesis in the original Analysis workspace

The synthesis workspace turns complete, reviewed Research result editions into a saved analysis protocol, a native pairwise synthesis, and a complete downloadable report. It uses the existing Analysis database, private launch capability, one original background worker, and normal workspace backup. Publications, protocols and run files travel with that database.

Open **Evidence synthesis** in the Analysis navigation. The page shares the original launch fragment and sends its capability in **X-Analysis-Capability**. It does not put that capability into API query strings, source files, protocol exports or recovery files. The Python client reads the original private **analysis-launch.json** through the maintained workbook requester.

## Complete operator journey

### 1. Import and inspect the source publication

Choose the complete original UTF-8 JSON publication exported by the selected Research workspace. The browser hashes the original bytes, retains the unchanged text in its request, and sends that expected SHA-256. The server saves the complete source before projecting descriptors.

Give the source a stable name. A new name uses expected current revision 0. Importing a following edition uses that name's actual current revision; the previous edition remains inspectable. Source and protocol names begin with a letter and contain at most 64 letters, digits, underscores or hyphens.

Select the two JSON pointers explicitly:

| Pointer | Meaning |
| --- | --- |
| Results array pointer | The array containing the full original result editions; for a document with a top-level results array, use /results. An empty pointer selects the document itself. |
| Descriptor pointer | The path within each array member to its original descriptor. Leave empty for direct descriptors; use /descriptor only for a real wrapper with that field. |

JSON pointer escaping follows the original source parser: **~1** means slash and **~0** means tilde. Import does not infer a partial publication from a title, a query preview, or a list of result IDs. The source context records the original kind, workspace and provenance; selected filename, complete byte count and SHA are retained alongside it.

The source page shows 50 original descriptors at a time and names its exact revision. Paging remains attached to that revision. The page filter applies only to the displayed source page and is labelled accordingly. Every descriptor keeps its original fields, result and edition IDs, Study reference, result state and source bindings.

The local descriptor SHA is a separate envelope field. It is never inserted into the original descriptor. The browser's source display preserves numeric tokens from the returned text; it does not round a source number and then send it back. **Download original source** receives and checks the complete original file.

### 2. Define the protocol and review each result

Choose **Use this publication for a new protocol**. Set the question, title, reviewer and rationale, then fill all seven comparability fields:

- Population.
- Outcome.
- Intervention.
- Comparator.
- Timepoint.
- Estimand.
- Unit.

Each included result explicitly confirms those same fields. Editing the protocol cohort preserves the older row decision and marks it for renewed comparability review. It does not silently change the meaning of an accepted row.

Open each original source result and inspect its accepted numeric fields and full source bindings. Choose inclusion or exclusion and record a reason. An unresolved result can remain unreviewed or be excluded. Included results require a resolved original record with source bindings, a selected contrast direction, and an explicit independence choice.

**Independent intervention and comparator groups** applies to ordinary independent arm summaries. **Reported adjusted estimate** preserves the original adjusted contrast. Dependent designs need their reported adjusted effect and uncertainty; choosing a flag does not turn correlated raw arms into independent groups.

A reviewed exclusion remains in the saved protocol and output report. Unreviewed results remain visible in the source and the review's unselected list. Removing a decision returns that result to unreviewed status.

The native review enforces one included result per original Study. This prevents two result editions, outcomes or timepoints from contributing twice as independent evidence to the same pooled estimate. Resolve a conflict by selecting the intended contribution and recording the other result's exclusion. The complete original descriptors remain in the publication.

### 3. Map accepted numeric fields

The operator selects exact original field IDs. A field can be read directly, or two or more original fields can be selected as an explicit sum using **field_a + field_b**. The engine retains each operand and the decimal-sum transformation in the result.

| Input structure | Required accepted fields | Effect measures |
| --- | --- | --- |
| Binary group counts | Intervention events/total; comparator events/total | RR, OR, RD |
| Continuous group summaries | Mean, SD and total for each group | MD, SMD |
| Reported estimate and standard error | Estimate and SE | Selected compatible measure |
| Reported estimate and confidence interval | Estimate, lower and upper bound; original confidence level and interval distribution | Selected compatible measure |

For a reported RR, OR or HR standard error, select the original log analysis scale. A displayed ratio confidence interval can be transformed from its positive ratio scale by the native engine. The interval input also records its original normal or t distribution and, for t intervals, degrees of freedom.

The engine checks whether a reported confidence interval can support its stated inversion. An asymmetric interval that fails the native symmetry rule requires the reported standard error. Invalid counts, missing accepted values, nonpositive uncertainty and unsupported source states remain visible with the original result.

Choose a global mapping for common original forms. A result can carry a reviewed mapping override when its own original fields differ. Fields marked as derived are used only when the corresponding analysis option is explicitly selected. Original lexical values, operand fields and transformation remain available in the complete output.

### 4. Select methods and sensitivity analyses

The protocol records:

| Control | Native selection |
| --- | --- |
| Effect measure | Risk ratio, odds ratio, risk difference, mean difference, standardized mean difference or hazard ratio |
| Model | Common effect or random effects |
| Between-study variance | Paule–Mandel or DerSimonian–Laird |
| Pooled interval | Normal or HKSJ; common effect requires normal |
| Alpha | A value strictly between 0 and 1; 0.05 selects a 95% interval |
| Zero-cell handling | None, or the explicit 0.5 rule for an actual zero-cell study |
| Derived accepted values | Explicit on/off |
| Leave-one-study-out | Explicit on/off; requires at least three estimable studies |
| Paule–Mandel controls | Positive tolerance at most 0.001 and 1–100,000 iterations |

Prespecified subgroups have stable IDs, labels and rationale. Assign a result's original subgroup level in its result review. An unspecified level remains visible. Subgroup results are descriptive pools with the engine's interpretation; the workspace does not relabel them as an interaction test.

Sensitivity sets name the exact reviewed result IDs to omit and retain the reason. The primary protocol stays unchanged. The output also retains the common-normal, random-normal and random-HKSJ model comparisons.

Protocol text fields use complete single-line text; wrapped display is supported, while embedded control characters are rejected by the native contract.

### 5. Save, review and run

**Save protocol edition** creates the next immutable protocol revision. It binds the complete publication name, revision and SHA, every descriptor digest, all decisions, mappings, comparability and methods.

**Review saved edition** calls the native review on that exact revision. Inspect its included, excluded, unresolved, non-estimable and unselected rows, duplicate-Study conflicts, numeric operands, transformations and package availability. Editing the draft invalidates its current run review until the new edition is saved.

The engine availability read comes from the actual selected runtime. It reports the installed statsmodels, NumPy, SciPy and Matplotlib packages. The original synthesis extra supplies the required statsmodels version. Source import and protocol editing remain usable when the calculation extra is unavailable.

**Run reviewed synthesis** uses an original 32-hex job ID. The existing Analysis worker owns the job. If another original Analysis job is active, the server returns its normal running-job result rather than starting a second worker.

The run page shows the exact input binding, status, native progress and any original error. **Cancel original run** requests cancellation of that ID. **Resume original run** reuses the same retained job and protocol selection after interruption, failure or cancellation. Refreshing the page does not automatically restart a settled job.

### 6. Inspect and receive the complete analysis

The result page shows the primary pool, model and interval comparisons, original study decisions, weights, heterogeneity, leave-one-study-out analyses, subgroups and sensitivity sets. Displayed calculated values use six significant digits. The downloaded native JSON retains the complete calculation.

Original forest and funnel SVG files are downloaded through the authenticated native stream and verified before they are displayed as images. The page does not inject report HTML or source SVG as executable page content.

The complete output set includes:

- The original publication bytes.
- The saved protocol.
- Full result JSON with accepted numeric inputs and sources.
- Study and diagnostic CSVs.
- Native forest and funnel figures.
- The readable HTML report.
- The file manifest.
- A complete synthesis ZIP.

Each browser download checks the original complete byte count, SHA-256 and strong ETag. The HTML report, figures and ZIP are useful independent artifacts; the complete SQLite workspace backup also retains every publication, protocol revision and output BLOB.

## Browser recovery

The browser retains the original request and reads it back before dispatch. Source imports, protocol saves and run starts receive stable operation IDs. A complete native reply is retained before interpretation. A lost connection, malformed JSON or unsuccessful response leaves that original request available in **Recovery**.

Recovery can inspect the original endpoint/body digest, download its full request, retry the same operation, or reopen its original result. Repeating an identical prepared action reuses the retained ID. A different source or reviewed revision forms a different request.

Protocol drafts and in-progress result decisions are retained in IndexedDB under the original workspace ID. The capability remains in the original browser session. A failed recovery write prevents a new request from being sent and leaves the current editor content available.

**Export recovery file** carries the original request bodies and retained draft without the capability. It is private working material because it can contain full source publications. Import it into the same original workspace after opening that workspace's private launch link. This also carries the original IDs across a browser profile or a new loopback port. Importing a recovery file does not dispatch its requests automatically.

An original revision conflict preserves the request and current editor content. Inspect the current saved edition, then make an explicit following revision or a new named protocol. Changing an old request's body while keeping its ID is rejected.

## Python SDK

The client is **stellar_forge_buyer.synthesis_client.WorkspaceSynthesisClient**. It subclasses the maintained workbook client for original launch selection, no-proxy loopback requests, refused redirects, capability headers and workspace identity.

It borrows the existing running workspace:

~~~python
from pathlib import Path
from stellar_forge_buyer.synthesis_client import WorkspaceSynthesisClient

client = WorkspaceSynthesisClient(Path("/private/original-analysis-workspace"))
sources = client.history(kind="publications", limit=25)
for source in client.iter_history(kind="publications"):
    print(source["name"], source["revision"], source["sha256"])
~~~

The source import takes the complete original bytes or an original file path. Its operation directory must be private and reused on retry:

~~~python
saved_source = client.import_publication(
    Path("/private/research/publication.json"),
    name="reviewed_results",
    expected_revision=0,
    results_pointer="/results",
    descriptor_pointer="",
    source_context={"kind": "original-research-publication"},
    operation=Path("/private/operations/import-reviewed-results"),
)
~~~

Select actual descriptor envelopes from that edition. The SDK yields the original descriptor and its separate digest:

~~~python
for item in client.iter_results(
    saved_source["name"], revision=saved_source["revision"]
):
    descriptor = item["descriptor"]
    digest = item["descriptor_sha256"]
    print(descriptor["resultId"], descriptor["editionId"], digest)
~~~

Save a complete original plan after reviewing its actual descriptors:

~~~python
saved_protocol = client.save_protocol(
    name="primary_comparison",
    expected_revision=0,
    publication={
        key: saved_source[key] for key in ("name", "revision", "sha256")
    },
    definition=reviewed_plan,
    operation=Path("/private/operations/save-primary-comparison"),
)

review = client.review(saved_protocol["name"], saved_protocol["revision"])
~~~

The application or human operator must inspect that actual review before selecting a run. The SDK sends the exact saved binding:

~~~python
job = client.start(
    protocol_name=saved_protocol["name"],
    protocol_revision=saved_protocol["revision"],
    protocol_sha256=saved_protocol["sha256"],
    operation=Path("/private/operations/run-primary-comparison"),
)
job = client.wait(job["id"], timeout=300)
if job["status"] == "COMPLETE":
    received = client.receive_run(
        job["id"], Path("/private/received/primary-comparison")
    )
~~~

**client.resume(original_operation_directory)** reopens its immutable intent and repeats the same original request. **client.job(id)** reads its current state. **client.cancel(id)** sends the native empty-body cancellation request. **client.result(id)** reads the completed summary. **client.receive_publication(name, revision, destination)** receives the complete original source bytes.

**run_protocol(...)** combines original start, wait and complete receiving under one private operation directory. A non-complete job returns its actual status, ID, progress and error so the caller can resume deliberately.

Every retained SDK intent binds the original database directory, workspace ID, endpoint, request kind, full body and ID. Raw HTTP responses are saved under their actual digest before parsing. Reusing the directory with changed input fails; a response timeout does not mint another run.

## Shared native and HTTP file receiving

The SDK and maintained native CLI use the same callable:

~~~python
receive_synthesis_file(
    record,
    destination,
    open_stream,
    binding={"workspace_id": workspace.identity, "run_id": original_job_id},
)
~~~

**record** includes name, complete bytes, SHA-256 and MIME. **open_stream(offset)** is a context manager yielding a binary stream and:

~~~json
{
  "status": 206,
  "offset": 1024,
  "length": 3072,
  "bytes": 4096,
  "sha256": "the original complete 64-character file digest"
}
~~~

For the original native store, use its existing download context, seek to the requested offset, and supply the complete record identity. A fresh native stream returns status 200 at offset 0; a resumed stream returns 206.

~~~python
from contextlib import contextmanager
from stellar_forge_buyer.synthesis_client import receive_synthesis_file

@contextmanager
def original_stream(offset):
    with workspace.synthesis.download(original_job_id, record["name"]) as (stream, native):
        stream.seek(offset)
        yield stream, {
            "status": 206 if offset else 200,
            "offset": offset,
            "length": native["bytes"] - offset,
            "bytes": native["bytes"],
            "sha256": native["sha256"],
        }

receipt = receive_synthesis_file(
    record, target, original_stream,
    binding={"workspace_id": workspace.identity, "run_id": original_job_id},
)
~~~

The HTTP adapter uses the original strong **sha256-...** ETag with Range/If-Range and validates Content-Range. The common receiver retains an exact partial file and selection journal, uses one kernel-owned file lock, and hashes the full content before publishing. A matching complete destination reopens; a different destination file is never replaced.

The returned receipt contains path, name, complete bytes, SHA-256, MIME and the original resume offset. The same path and binding must be supplied after interruption. A changed partial identity or failed complete digest remains an explicit file error; retain its diagnostic record and resolve that owned partial before resuming.

## Integration source

The additive browser module is **_analysis_synthesis_ui.py**, exporting HTML, JS and CSS. The original **synthesis_http.py** serves those assets and calls the same **AnalysisSynthesis** owner. The main Analysis navigation gains only its source-aware link and original capability fragment. Actual verified figures use the server's same-origin/blob image policy.

The SDK is **synthesis_client.py**. It imports the original workbook requester and native storage utilities. The maintained native CLI composes its file receiver against the original store context rather than implementing a second downloader.

The complete source-native receiving operation should use a real retained Research publication, preserve its full Study/form/result editions, save the protocol, run the original engine, receive all original files, export the ordinary workspace backup and reopen that same analysis. It is one complete product journey; its results belong with the selected source and output identities.

### Reopening an earlier protocol from Recovery

Reopening an original protocol retains its same request ID and opens the publication name, revision, and SHA selected by that saved protocol. If the current protocol or a result decision has unsaved changes, the operator chooses whether to replace them before the original request is retried. Successful adoption clears the previous result editor and displays the retained protocol against its own freshly read source edition. A failed source read leaves the prior editor available and the original saved request available for the same recovery.
