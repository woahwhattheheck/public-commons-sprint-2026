# Heritage Training Research

A complete source-edition workbench for qualification, provider and course-offering research. It keeps the original public-source definitions beside the researcher's decisions and repeatable analysis.

## Open and operate

Open the delivered `index.html` in a current desktop browser. The application works locally and stores its editable projects in this browser's IndexedDB. The same complete HTML supports a 390-pixel viewport. Use **Download complete work** to transfer the application, original source, current project, every table edition and saved reports. Use **Receiving** to open that ZIP or a complete project JSON on another browser. Preserve a download before clearing browser data or moving the file to another origin.

The first project contains primary-source examples and source definitions. Provider enrolments, physical venues and learner counts must be entered from the actual selected data; an empty table has not been interpreted as zero provision.

## Build from the complete source

Node 22 or later can build the application without installing packages:

```sh
node build.mjs
node build.mjs /absolute/project.json /absolute/new-output
node cli.mjs show --project /absolute/project.json
```

The builder reads the complete SOURCE_FILES.json inventory, creates the original Source Tables project, and writes index.html, project.json, the complete ZIP and its manifest under dist. The CLI writes a new output path with exclusive creation for each edit, review, imported edition or analysis.

## Source and responsibility

The four maintained Source Tables modules are unchanged: onboarding.mjs, source-document-tables.mjs, source-table-intake.mjs and source-table-workspace.mjs. Their original source, table mappings, retained reviews, CSV handling, import validation and native workspace format remain intact. SOURCE_ORIGINS.json records their exact identities.

The new model records explicit research joins, date ranges, value statuses, source coverage and material-bound research judgments. A saved analysis contains the full selected source tables, original review identities and complete review roster. Receiving reproduces its result. The report exposes where the data does not support an aggregate, location claim or population conclusion.

Read OPERATOR.md for the complete workflow and DATA_METHOD.md for the research boundaries. The internal commercial proposal is maintained separately from the portable application.
