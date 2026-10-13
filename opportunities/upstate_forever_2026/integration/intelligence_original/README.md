# Eco Science Investigations

**ASTRA-ECO-INTEL13 · internal Ecosystem Sciences sprint contribution · 1.0.0**

A complete data-interrogation and guided-action workspace for registered watershed inputs and retained model results. Python/FastAPI engine, grayscale browser interface, durable investigation store, complete-source analytical tools, server-configured LLM tool calling, native job adapters, and HTML/JSON handover exports.

## What the operator can do

Open `/intelligence`, load the existing tenant, and create or reopen an investigation. Inspect CSV/TSV/JSONL tables, georeferenced TIFFs, vectors and JSON result files. Browse original jobs and their registered artifacts, compare aligned rasters or exact-key paired tables, and keep complete results with content hashes and coverage. Ask a configured language model to inspect those same sources and explain its findings using retained source IDs. Prepare a collection analysis, a paired calibration request, an existing model job or a parameter-grid ensemble; execution goes through the connected original services. Reopening an accepted submission does not submit it again.

Investigations survive process restart. Export creates complete JSON or a self-contained readable HTML report containing the original questions, answers, results, source hashes and action outcomes. The original application's map, AOI, training and modeling pages remain intact.

## Start

Python 3.11+; the supplied validation used Python 3.13. Install dependencies from `requirements-intelligence.txt`. This archive contains **extension source**, not the full upstream watershed app.

For the older `app.py` / `settings.py` / SQLite registry layout:

```sh
python -m pip install -r requirements-intelligence.txt
python install_intelligence.py /path/to/original/eco_app --mode legacy
cd /path/to/original/eco_app
uvicorn intelligence_app:app --host 127.0.0.1 --port 8000
```

For the current workspace application, use the read-through/native-service adapters in **INTEGRATION.md**. They avoid imposing the old SQL schema on the new store. A host-produced catalog projection can also be opened directly:

```sh
python -m eco_intelligence --catalog /path/to/catalog.json \
  --data-root /path/to/original/data --state /path/to/investigations.sqlite \
  --host 127.0.0.1 --port 8000
```

The standalone catalog mode supports full interrogation, reports and LLM analysis. Model operations appear only when their original service bindings are installed. No model engine, field observations, or provider account is fabricated by this package.

## Language model

Configure the server with `ECO_LLM_BASE_URL` (including `/v1`), `ECO_LLM_MODEL` and, when required by that provider, `ECO_LLM_API_KEY`. The implementation calls the Chat Completions tool protocol. A remote provider must use HTTPS; a local provider may use loopback HTTP. Keys stay on the server and are not placed in the browser, reports or investigation records. The provider configuration chooses the actual model; no particular commercial account is assumed.

`ECO_LLM_MAX_ROUNDS`, `ECO_LLM_TIMEOUT`, and `ECO_LLM_MAX_COMPLETION_TOKENS` configure per-question runtime limits. Completed analyses survive errors and remain usable for a subsequent question. All file computation covers the complete population. Large tool output is transported in 18,000-character pages without discarding the retained original result. The question starts with a newly computed registry snapshot; tools can inspect files, inspect native records, prepare typed actions and read retained pages. Only application action controls execute model work. Citation validation checks that cited IDs exist in the investigation; it does not independently prove the semantic correctness of an LLM answer.

Review the configured provider's own data handling before enabling it for a protected deployment. Asking a question sends the question, conversation context, and tool-result pages to that configured endpoint. Local analysis and guided operations do not require an LLM.

## Scientific meanings

Raster comparison requires matching CRS, dimensions, transform and band units; it retains the grid definition, paired valid-cell population and excluded-cell counts. Undeclared units are reported. No implicit reprojection or conversion occurs. Pixel statistics and cell sums are not automatically watershed sediment mass.

Table comparison uses a disk-backed complete exact-key join. Duplicate keys are rejected instead of overwriting observations. Missing or nonfinite values, unmatched rows, RMSE, MAE, NSE and explicitly defined percent bias are retained. Bias here is **100 × (sum(predicted) − sum(observed)) / sum(observed)**; negative values indicate underprediction. Units, period and spatial support must match for scientific interpretation.

Paired calibration canonicalizes ISO timestamps to UTC before matching, rejects duplicate physical periods, requires explicit identical input units and retains the full paired population. The legacy adapter invokes the original chronological-holdout **output-correction** operation. Native parameter calibration is supplied through the current workspace's own typed builder and method description. These are distinct operations; a fitted output correction is not represented as a fitted SDR parameter set. Grid ensembles describe scenario sensitivity unless the original native engine supplies a calibrated probabilistic interpretation.

## Structure

`profiling.py` performs full-population analysis. `repository.py` reads the earlier SQLite registry without writing it. `adapters.py` reads the current original store through callbacks or a host-produced manifest and invokes the existing workspace job launcher. `engine.py` prepares and executes source-bound operations. `store.py` retains investigations in a separate WAL SQLite database. `provider.py` implements real tool calling. `api.py` mounts the browser and HTTP surface. `static/` contains the complete grayscale interface.

## Validation

Run `python -m unittest discover -s tests -v`. Five integration journeys cover the older route contract and the current-workspace adapter seam, full-file analysis, original-route action calls, source mutation, tenant isolation, restart, exact lost-response reconciliation, and provider tool-call round trips. Native service and provider responses in these journeys are **controlled integration fixtures**, not live environmental runs or a paid provider session.

Optional capacity exercise: `PYTHONPATH=. python tests/capacity_journey.py`. It authors one million rows in each of two tables and a pair of 4096×4096 georeferenced rasters, computes the complete populations and checks known results. The packaged run analyzed 16,777,215 paired raster cells. See `validation.json` for measured values and the browser-check mode.

The browser journey uses the exact shipped HTML/CSS/JavaScript in offline Chromium, with fetch calls dispatched to the running local HTTP API. It covers creation, full comparison, collection execution, HTML export, reopening, tenant switching and a 390px mobile layout. Served-page navigation was blocked by the container's browser administrator policy; no policy settings were changed. Screenshots are internal interface review artifacts made with explicitly authored fixtures.

The current core/calibration source was available as Slack contract/carrier descriptions rather than a recovered complete executable upstream checkout. Consequently, the native store and payload-builder seams are implemented and fixture-validated; installation into that running original workspace remains a separate integration operation. **INTEGRATION.md** gives exact adapters and adoption contracts for that operation.
