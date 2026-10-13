# Client study briefing

The complete client report now includes an offline briefing for a decision meeting. Open **Open customer briefing and meeting notes** in the client HTML, or **Open customer briefing** in the extracted atlas.

The briefing carries the report's exact paragraphs, table columns, values and row order. Tables continue in groups of six rows and paragraphs in groups of three. Every page links back to its original report section. The report's source scope, native grid, actual model selections, comparison support and original interpretations travel with that same material.

## Discuss the study

Start in reading mode. The visible page follows ordinary scrolling, so a note added from the toolbar attaches to the material currently on screen.

Use **Agenda** to select complete sections for a meeting. **Core briefing** selects the study, current exports, alternatives, map decision guide, priorities, parcel context and any project interpretation present in that report. **All sections** exposes the entire report, including methods, observations, source editions, receiving-water quantities and working material. Every row remains available.

Choose **Present** for one page at a time. Previous, Next and the section selector navigate the selected agenda. Left/Right, Page Up/Page Down, Home and End work when focus is outside an editing control. Escape returns to reading mode. Fullscreen is optional.

Map pages open the retained map files in a separate browser tab. Keep the briefing with the extracted delivery folder so those files and report links remain available. The page runs locally without a web service or external scripts.

Use the **Print** selector to choose **Current briefing page**, **Selected agenda**, or **Agenda and meeting notes**, then choose **Print**. The current-page option follows the page shown in the counter in either reading or presentation mode. Browser print can save the selected material as a PDF. Landscape layout keeps repeated table headers and every row; content can continue naturally onto another physical sheet. The selected print scope also applies to the browser's Print command.

## Record the meeting

Open **Meeting notes**, supply a title, date, participants and purpose, then add a question, decision or follow-up action for the current report page.

Each entry contains:

- The original report page and section.
- The question, decision or action text.
- Owner and due date.
- Open, In progress or Complete status.

**Open report page** returns directly to the source material for an entry, adding that complete section to the active agenda if needed. Removing an entry asks for confirmation.

Notes are saved in the local browser when storage is available. **Export meeting file** writes the complete editable JSON record; **Export readable notes** writes Markdown. Both include the exact report identity and selected agenda. Opening the JSON record in another copy of this same briefing restores the meeting and its action list.

A meeting record belongs to the original report-model bytes and briefing edition. An imported file from a different report is identified by its binding before any current notes change. Opening an imported meeting asks before replacing entered notes. Browser storage can be unavailable for local files in some configurations; the page reports this and export remains available. Python computes the original report-model hash during generation, so opening the briefing under `file://` does not depend on browser hashing or a secure web origin.

The notes are a meeting record alongside the source report. Model inputs, numerical results, scientific interpretations and original delivery files retain their existing meaning.

## Generated files and normal delivery integration

The ordinary delivery builder generates six client companions:

| File | Purpose |
| --- | --- |
| client-report.pdf | Paginated original client report |
| client-report.html | Complete offline report with briefing link |
| client-report.md | Original client report in Markdown |
| client-report-model.json | Complete structured report |
| client-report-briefing.html | Meeting presentation and local notes |
| client-report-briefing.json | Briefing binding and complete page/source index |

The two new descriptor keys are **client_report_briefing** and **client_report_briefing_index**. They enter the existing complete project-assets list, native working archive, delivery snapshot and GIS package. The maintained client companion producer edition contributes to the existing delivery identity before a new report is built. The briefing binds the actual report edition retained in that report model.

The briefing index records every page's source section, original table index, starting row and row count. Its binding includes delivery, baseline, ordered alternatives, grid, profile, delivery mode, original report edition, and SHA-256 of the exact retained report-model file bytes. **report_digest_method** identifies that byte basis. The renderer does not recompute physical or financial quantities.

The standalone rendering function accepts a report object with an optional original model byte string. With original bytes, the semantic report content must match those bytes. Direct in-memory rendering without a file records its canonical-JSON digest method explicitly. The normal delivery writer always supplies the original complete model file.

## Add a briefing to an extracted client delivery

Use the application's existing Python environment and the extracted report folder:

~~~sh
python -m model.client_briefing \
  --report-model /absolute/extracted-delivery/client-report-model.json \
  --directory /absolute/extracted-delivery \
  --stem client-report
~~~

The command reads the original model beside its HTML and writes the two briefing companions in that extracted folder. Normal workspace releases use the maintained delivery build action so every generated descriptor is retained in its existing package inventory.

No added Python dependencies are required. The browser source is embedded in the generated HTML, with an exact script hash in its content-security policy. Visible report values and user-authored meeting entries are rendered as text.

## Source integration

**model/client_briefing.py** owns content pagination, source binding, grayscale layout, presentation navigation, agenda, local note state, print and import/export.

**model/client_report.py** adds the briefing link, generates the two companions after the original report, and advances the companion producer edition.

**model/delivery.py** requires the complete six-file companion set when continuing a newly selected delivery and publishes those paths through its existing manifest.

**model/atlas_browser.py** opens the actual captured briefing when its descriptor is present in the package's member inventory.

All underlying scientific, economic, observed, receiving-water and native runtime producers keep their current behavior.
