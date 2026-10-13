# Observed report rendering editions

The maintained SourceReports operation renders ordered saved scientific sources
through `model.observed_report_render`. Its original provider, action queue,
file transport, source catalogue and archive receiving remain the report path.

This successor updates the presentation and source identity used by newly
prepared observed reports. It also streams original companions into the complete
Workspace archive's retained report directory.

## New observed presentation

New previews retain this presentation in `render_identity.presentation`:

- edition: `observed-report-presentation-20261013-v2`;
- subtitle: “Original observations, scientific context and retained source editions”;
- footer: “Original source records and selected scientific report editions”.

The existing scientific formatter receives the explicit observed subtitle/footer
for HTML, Markdown, JSON and PDF. Contact defaults to an empty object. If the
operator supplies a contact, the original text values remain in the report's
identity and formatter input. The renderer does not assign a regional team or
organization to a source.

The resolved title is always part of a new preview's identity, including a
default title obtained from its original selected source. Ordered source choices,
their binding and complete source inventory keep their existing semantics.

## Rendering code identity

Each new preview retains actual installed byte counts and SHA-256 values for:

- `model/observed_report_render.py`;
- `model/scientific_report.py`;
- `model/scientific_figures.py`;
- `model/observed_context.py`.

They are included in `render_identity.rendering_sources`, so a changed
renderer produces a different prepared edition even when the formatter's
general report-version label remains the same. Before rendering an incomplete
new edition, the native operation checks that these sources still match the
reviewed hashes. The exact four Python files are also retained under
`rendering-source/model/` and registered as ordinary report members. They travel
in the report ZIP and complete Workspace archive, preserving the original code
for an older edition even after the installed application is updated.

Completed saved editions keep their original operation identity. Existing
`ScientificReportEditions.detail/export` continues to verify their retained
source and output files without requiring new preview fields. The renderer's
completed-operation branch also preserves that original identity. Historical
previews lacking the new presentation fields use their existing formatter
call behavior when explicitly continued.

A current preview for changed presentation or code is a new edition. The
operator already selects its directory from the complete identity. A CLI caller
preparing that new edition must choose its own new output directory; it must
not overwrite a prior completed report directory.

## Bounded original file retention

`archive_report` keeps its existing complete Workspace/application/report
archive and independent restore verification. Retaining each original report
companion now uses 1 MiB reads and writes instead of loading a complete file into
memory. The copy verifies the original byte count and SHA-256 while streaming,
flushes it, and atomically links it into the existing retained directory.

An existing destination is verified and reused. A conflicting original file is
rejected. The original caller still verifies the source before and after
retention and checks the retained copy. Temporary files are removed after their
atomic publication attempt. This preserves original CSVs, figures and source
companions while keeping transfer memory independent of a companion's length.

## API and integration

Public signatures remain unchanged:

```python
prepare(workspace, choices, *, title=None, contact=None, manifest_paths=None)
render(workspace, preview, output)
archive_report(workspace, directory, result, archive_path, receive_path=None,
               *, app_root=None)
```

New preview JSON adds presentation and rendering_sources, both already retained
inside render_identity. Existing consumers can ignore these additional fields.
The source schema, ordered selection, collection/source IDs, report filenames,
provider routes and queue actions remain compatible.

This source is based on the complete ES26 publisher at public commit
55cbd08e73a0648d00d5af464d6640665e4893cc and uses the explicit formatter keywords
published with PR3398. Compose the single renderer replacement against the
current owner postimage, retaining any later original source changes. The
existing recursive model/docs source traversal includes the module and this
guide. No additional report operation or workspace directory is introduced.
