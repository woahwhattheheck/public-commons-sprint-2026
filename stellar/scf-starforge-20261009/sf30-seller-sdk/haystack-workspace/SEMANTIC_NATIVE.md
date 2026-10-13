# Native Brick modelling and complete validation

This package supplies the original Brick 1.4.4 ontology, an immutable terms catalogue, lossless delimited-file inspection, and a native validation adapter. The Haystack workspace retains each original source file and model edition; this adapter receives one exact request and returns complete output files. Ordinary catalogue browsing reads the packaged catalogue. Inspection and validation never download dependencies, ontologies, imports or remote data.

## Selected standard and engine

The standard is the complete combined Brick 1.4.4 / REC ontology obtained from [Brick's official resources](https://brickschema.org/resources/), with the original [1.4.4 Turtle](https://brickschema.org/schema/1.4.4/Brick.ttl) and [release licence](https://github.com/BrickSchema/Brick/blob/v1.4.4/LICENSE). The selected ontology is 1,749,633 bytes, SHA-256 b65720b7b9b64c646745c689777e6138c0d59ce0088df0aeb78fbd444d04d8e7. Its licence is 1,534 bytes, SHA-256 3f4d165cc1c2b234d4bca6462971cb318ef525961cc688b3280a96b2fde932af. The actual HTTP receipts accompany the offline archive.

The adapter explicitly loads this local ontology. It does not use the newer ontology bundled by default in the selected brickschema wheel. The native engine is brickschema 0.8.0, RDFLib 7.6.0 and pySHACL 0.40.1. Every resolved dependency, original wheel hash, licence and selected engine source hash is retained in semantic-dependencies.json and the offline archive. The selected complete wheel set targets **CPython 3.12 on Linux x86_64**. A different Python ABI or platform requires an explicitly prepared matching dependency edition.

The original APIs are documented in [Brick validation](https://brickschema.readthedocs.io/en/latest/validate.html), [py-brickschema](https://github.com/BrickSchema/py-brickschema), [RDFLib](https://rdflib.readthedocs.io/) and [pySHACL](https://github.com/RDFLib/pySHACL). The archive includes the exact installed engine functions used here, so receiving does not depend on later documentation changes.

## Complete application leaves

| File | Purpose |
| --- | --- |
| semantic_native.py | Original request/response adapter and complete-report orchestration. |
| requirements-semantic.txt | All resolved package versions and wheel SHA-256 requirements. |
| semantic-brick.ttl | Exact original Brick 1.4.4 ontology, including its local shapes and REC terms. |
| semantic-brick-LICENSE.txt | Unmodified original standard licence. |
| semantic-standard.json | Standard identities, retrieval receipts and selected engine options. |
| semantic-catalog.json | Complete native-generated classes, properties, tags and available unit terms. |
| semantic-dependencies.json | Exact offline archive, internal manifest, package and engine-source identities. |
| install_semantic_runtime.py | Explicit offline environment receiving and same-directory recovery. |
| SEMANTIC_NATIVE.md | This installation, protocol and receiving guide. |

The separate Haystack_Brick_1.4.4_Offline_Dependencies_20261012.zip contains all selected wheels, original licences and source receipts. Its exact bytes and SHA-256 are bound by semantic-dependencies.json. The complete application export includes the nine source leaves; deliver the bound dependency archive beside it when the recipient needs native inspection or validation.

## Explicit offline installation

Use the CPython 3.12 interpreter supplied by the receiving host. Replace the absolute paths below with the original received application, archive and intended private environment directories:

~~~sh
python3.12 /ABS/APP/install_semantic_runtime.py \
  --archive /ABS/FILES/Haystack_Brick_1.4.4_Offline_Dependencies_20261012.zip \
  --manifest /ABS/APP/semantic-dependencies.json \
  --directory /ABS/ENV/brick-semantic
~~~

The installer verifies the whole archive, every member, the complete selected wheel set and the requirements file before installation. It creates a venv at its final path and uses pip with --no-index, --find-links and --require-hashes. It never installs on behalf of inspect, catalog or validate. The venv bootstrap is supplied by the receiving Python installation; the eleven third-party package versions are all selected by this archive.

Configure the original application with the resulting absolute interpreter path:

~~~sh
export HAYSTACK_SEMANTIC_PYTHON=/ABS/ENV/brick-semantic/bin/python
~~~

The existing semantic-native.mjs reads HAYSTACK_SEMANTIC_PYTHON. The whole receiving programme supplies the same path as nativePython and sets that environment variable before workspace calls. An installed Applications instance can retain it in its existing private environmentFile. No additional application CLI flag or implicit package installation is needed.

A successful response has schema commons.haystack.semantic-runtime-receipt.v1 and state COMPLETE. It records the actual Python path/version, all installed dependency versions, exact selected engine source hashes, the installed file inventory and the archive binding. The environment contains semantic-runtime-receipt.json; its adjacent original operation record, lock, input directory and log retain recovery state.

Repeat the identical command after an interrupted install. The original destination and source binding must match. An existing unrelated environment is rejected. A complete environment is rechecked and returned with reopened:true. Preserve the environment at its original path: moving a venv would break its script shebangs. To commission a different destination, explicitly receive a new environment from the same archive.

## Request and result protocol

The adapter reads one UTF-8 JSON request from standard input and writes one complete JSON result to standard output. It also supports exact file input and atomic file output:

~~~sh
/ABS/ENV/brick-semantic/bin/python /ABS/APP/semantic_native.py \
  --input /ABS/OPERATION/request.json \
  --output /ABS/OPERATION/result.json
~~~

The caller owns the original request ID, input/source hashes, workspace lock and process observation. Before launching another child after a lost parent response, it reads the original completed result file and checks the same request/model/source bindings. The adapter writes a complete result atomically; it does not create another workspace transaction or perform an automatic replay.

Every result uses schema commons.haystack.semantic-native-result.v1, includes ok and action, and retains the request-byte and adapter-source hashes. Runtime metadata reports the actual Python and selected dependencies plus the exact standard and licence. Invalid requests, missing dependencies, unsupported data and interrupted execution produce a structured error and nonzero exit. stdout contains the JSON protocol; library output is captured and retained as runtimeMessages. The input limit is 64 MiB.

### inspect

Input is {action:"inspect",file:{name,format,bytes,sha256,base64},delimiter?}. format is csv or tsv. delimiter is a comma, tab or semicolon; the default follows format. The actual bytes and SHA-256 must match the complete base64 input.

Inspection uses Python's original csv.reader and UTF-8 with an optional BOM. It preserves every header position, including duplicate and blank names, every cell string, variable-length and empty rows, original data-row indices, and the physical line on which each parsed row ends. Quoted multiline fields retain their text and correct physical end line. Cells are not interpreted as numbers, formulas, dates or missing-value markers.

The result includes file identity, columns, rows, rowEndLines, headerEndLine, encoding, delimiter and diagnostics. Duplicate/blank headings and row-width differences are visible diagnostics. Data rows are indexed from zero after the header; physical line numbers start at one. The explicit limits are 32 MiB of source bytes, 25,000 data rows and 256 columns. Exceeding a limit returns an error; no accepted result is silently truncated.

### catalog

Input is {action:"catalog"}. The result contains complete classes, properties, tags and units arrays. Each row has iri, label, definition, parents and kind, with the original language/datatype-bearing labels and definitions retained where present. Property types, deprecation flags and graph counts remain available. Referenced unit terms absent from a full imported unit vocabulary remain represented with the information actually present in the selected local ontology. The adapter does not fetch their remote definitions or invent labels.

semantic-catalog.json is this complete result generated from the selected ontology and engine. The application caches it by the retained file hash. A catalogue term is a mapping choice; presence in a catalogue is not evidence that an authored building model conforms.

### validate

Input is {action:"validate",model:{modelId,versionId,contentSha256,namespace,entities,relations}}. The application supplies stable entity IRIs; edits to names and display labels do not change those identities.

Each entity supplies id, iri, label, classes[], tags[], attributes[] and sourceRefs[]. An attribute is {predicate,kind:"iri"|"literal",value,datatype?,language?}; datatype and language are mutually exclusive. Literal lexical forms are retained. Source references contain kind ("native" or "intake"), sourceId and rowIndex, with optional recordKey and externalId. Relations contain id, subjectId, predicate and objectId. Unknown terms produce mapping observations while their triples and entities remain in the model.

contentSha256 is the application's exact full model-edition content digest. The native projection cannot reconstruct that larger object, so the adapter preserves the supplied binding and reports receivedModelSha256 for the complete native model projection separately. The caller also binds the exact request bytes. Successful validation results return the original modelId, versionId and contentSha256.

The model gate prevents source-authored SHACL declarations from becoming executable shapes before either engine call. It rejects model imports and attempts to redefine original ontology subjects. Actual validation uses local Graph objects and the exact trusted standard. Network access, OWL imports, SPARQL remote mode and JavaScript execution are disabled.

## Original engine and complete reporting

The adapter first calls the original Brick Graph.validate(engine="pyshacl") on an independent copy to retain the unchanged wrapper's report. That wrapper can stop after the first failing shape. A second independent data copy produces the complete report with the same selected pySHACL engine and local ontology.

For both routes, model blank nodes are skolemized once before the ontology is added; ontology shape blank nodes remain unchanged. The complete-report route uses advanced=True, inplace=True and allow_warnings=True, and changes abort_on_first to False. It leaves iterate_rules=False while driving the original outer rule loop. There are at least one and at most ten passes. Each pass records exact triple-set changes, rather than treating equal triple counts as proof of stability.

A bound-limited run is retained as SHACL_ITERATION_LIMIT with conforms:null and observedConforms from the last actual report. It does not claim a fixed point. The result retains the iteration count, stabilized observation, complete report and final expanded graph so an operator can investigate.

allow_warnings=True follows the selected pySHACL meaning: both Warning and Info results remain visible without invalidating the final conformance Boolean. Violations, warnings and informational results are all returned with focus node, result path, value, severity, source shape, constraint component, messages and any nested detail relationships. Mapping observations remain separate from SHACL conformance. No unconstrained source entity is omitted.

Every validation retains these complete output files:

| Output | Retained content |
| --- | --- |
| model.ttl | Original authored RDF graph serialized by RDFLib. |
| model.json | Complete native model projection and source references. |
| validation-report.ttl | Complete pySHACL result graph. |
| validation-report.txt | Complete human-readable pySHACL report. |
| brick-wrapper-report.ttl | Unchanged original Brick wrapper result graph. |
| brick-wrapper-report.txt | Unchanged original wrapper report text. |
| validation-expanded.ttl | Actual data-plus-standard graph after the complete rule passes. |

Each output entry includes name, mediaType, bytes, sha256 and base64. Preserve those exact bytes, all structured results, original request, ontology identity, effective options, entity bindings and graph counts in the workspace report and portable return. A complete report can be nonconforming; failure to satisfy a building rule does not mean the report was lost or replaced.

## Receiving and recovery responsibilities

The full point-modelling programme owns the source-derived Charlie input, retained imports, model versions, validation requests, operator review, contractor return choices and browser continuation. Adapter-level inspection or validation does not stand in for that whole workflow.

The application must compare modelId, versionId, contentSha256, request hash and native source identities before adopting a returned result. It retains exact original source files and all output members even when an operator keeps local modelling choices during a returned-work review. A subsequent validation is a separate explicit operation on a selected model edition.

If Python or a dependency is unavailable, preserve the draft and report the actual missing runtime. If a result is nonconforming, show the complete report and mapping observations. If the process or response is lost, reconcile the original durable result and process record before launching again. Preserve the completed archive and environment receipts during receiving or restart.
