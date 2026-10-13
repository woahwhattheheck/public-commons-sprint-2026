# Reach-network chemical transport and inference

**ASTRA-REACT12 · 0.1.0 · Ecosystem Sciences sprint, 12 October 2026**

This contribution adds a complete chemical-analysis arm to the existing Upper Savannah scientific workspace: multi-species transport, first-order transformations, explicit conserved-mass budgets, source attribution, parameter fitting, sensitivity, monitoring selection, and parameter-prior ensembles. The original application continues to own its source intake, workspace registry, native InVEST calculations, task queue, authentication and downloads.

## Open and run

Python 3.11 or later, NumPy and SciPy are required. Development execution used Python 3.13, NumPy 2.3.5 and SciPy 1.17.0. Install the supplied Python package with `python -m pip install .`, or use the source directory directly:

```sh
python -m reach_chemistry inspect examples/network.json
python -m reach_chemistry run examples/network.json examples/simulation-request.json --output ./chemistry-run
python -m reach_chemistry run examples/network.json examples/calibration-request.json --output ./chemistry-fit
```

The installed command is `reach-chemistry`. Each operation retains its complete project, request, result, HTML report, appropriate full CSVs, checksum manifest and result ZIP. Reopening an already completed CLI operation verifies the retained outputs. An interrupted simulation resumes from its last completed phase or observation boundary. Another request requires a separate output directory. Concurrent writers to the same CLI operation are excluded by a file lock.

`examples/network.json` is an authored four-reach mathematical reference, with explicit provenance on every physical object. It represents nitrogen and phosphorus basis masses, boundary throughflow, bidirectional exchange, phase-dependent source loading and five first-order transformations. Use actual retained input editions and site-specific coefficients for scientific applications.

## Install in the existing application

```sh
python install_chemistry.py --application /path/to/current/native/application --dry-run
python install_chemistry.py --application /path/to/current/native/application
```

Select the directory containing the original `model/workspace.py`, `operator/server.py` and `operator/web/app.mjs`. This may be the original application root or its `native` directory. The installer adds the package under `model/reach_chemistry`, installs the model/CLI/operator adapters and browser assets, and composes the current action registry, worker dispatch, read routes, immediate cancellation route, authenticated download decorations and `/#chemistry` navigation. It preserves unrelated modules and rejects divergent authored chemistry files for explicit reconciliation. Existing registrations are inspected before shared files are changed; a repeat installation is idempotent.

The original server contract is the Python Operator used by the publicly retained `install_programmes.py` and `operator/programmes.py` integrations. A host using a different frontend can call the same model adapter or installed native CLI without replacing its existing transport:

```sh
printf '{}\n' > payload.json
PYTHONPATH=/path/to/native/application python -m model.chemistry_cli \
  --workspace /path/to/existing/scientific/workspace chemistry.catalog payload.json
```

Native operations: `chemistry.case.save`, `chemistry.case.from-source`, `chemistry.case.get`, `chemistry.catalog`, `chemistry.run`, `chemistry.run.get`, `chemistry.result.page`, `chemistry.export`, `chemistry.receive`. The CLI also exposes `chemistry.cancel` and `chemistry.receive-file`. The operator sends cancellation directly on the request thread rather than placing it behind the calculation in the serial native queue.

The browser includes editable physical-value tables, complete project/provenance editing, retained-source selection, observation CSV intake, all six analysis modes, paginated results, original authenticated downloads, independent scenario editions and editable project export/receive. It uses grayscale presentation and retains native request identifiers across lost responses.

## Scientific contract

Each reach is a fixed-volume, completely mixed compartment. Water continuity must balance in every phase. Flows and exchange rates are m³/day; volumes are m³; external loads are kg/day; first-order rates are day⁻¹. State and outputs are kg and mg/L **of the species' declared conserved basis**, such as elemental N or P. These units are not interchangeable with the total molecular mass of a compound.

For every species and reach, the system advances `dm/dt = A m + b`. Internal advection removes source-reach mass at `Q/V_source` and adds that same mass downstream. Exchange adds paired transfers. A reaction removes first-order source mass and distributes explicit mass fractions to species with the same conserved basis. Fractions below one require a named untracked sink; fractions above one or cross-basis yields are rejected. Optional temperature correction requires an explicit theta, reference temperature and reach temperature. Each phase explicitly selects its flow, load, exchange and reaction multipliers.

The matrix exponential advances both `m(t)` and its time integral in one augmented sparse system. Outlet loads and reaction extents therefore use integrated mass, not endpoint averages. Budgets reconcile initial mass plus all inputs against final storage, boundary export and named reaction sinks. Small floating-point residuals remain visible; the engine does not clip concentrations, normalize away a mass discrepancy or silently convert annual outputs to daily loads.

Use this formulation for transport and transformations adequately represented by completely mixed reaches and phasewise-constant linear coefficients. Changing storage, nonlinear pH/speciation, interacting concentration-dependent kinetics and a hydraulic flow solution require their appropriate governing models and inputs. This contribution is complementary to the existing InVEST watershed calculations.

### Analyses

- **simulate:** `sample_days` and optional selected reach/species `targets`; full final-state and mass-budget exports remain available.
- **attribute:** independently propagates each named source tag and initial inventory, then verifies that the components recombine to the full calculation.
- **sensitivity:** directly assembles physical coefficient derivatives and advances the tangent equations with the same sparse exponential. Supported parameters are reaction rate, external load, boundary concentration and initial inventory.
- **calibrate:** bounded least squares with the analytical tangent Jacobian, explicit observation errors, separate fit/holdout records and one-sided below-detection residuals. Linear, soft-L1 and Huber objectives are available. A fitted child scenario is saved separately; local Jacobian rank and singular values expose identifiability.
- **monitoring:** greedy local D-optimal selection from supplied candidates, measurement errors and a positive-definite prior precision matrix. Returns every selected candidate and its incremental information gain.
- **uncertainty:** every draw executes the full selected network. Uniform, log-uniform and triangular parameter priors, an explicit seed and optional positive-semidefinite latent-Gaussian correlation are supported. Every parameter draw and every prediction is retained. Reported quantiles describe the specified parameter ensemble.

Observation CSV columns are `id,reach,species,day,mg_l,sigma_mg_l`; optional `role` is `fit` or `holdout`, and `qualifier` is `equal` or `below`. Each observation carries its original source reference. Parameter definitions always include explicit physical targets and lower/upper bounds.

## Retained projects and independent receiving

`model/chemistry.py` uses the existing Workspace `_save`, `_get`, `_list`, `source_file` and `import_sources` operations. Chemical scenarios are immutable, content-addressed editions with retained original source identities and an edit reason. Runs bind the exact case, project content, request and engine version. Complete results are verified before reuse. Progress and content-addressed integration checkpoints are persisted within the native chemical run.

Editable transfer includes the complete selected project, original selected source files and companions, original source manifests, selected completed run requests/results/reports and a byte/hash inventory. Receiving verifies names, inventory and every file, imports sources through the original writer, adopts complete runs into the receiver's own catalog and restores fitted child scenarios. The receiver can edit, calculate and re-export independently. Original incoming run identities and source provenance remain attached to the local editions. A repeated export reuses the same verified archive, and a repeated receive returns the same receipt.

## Executed delivery exercises

All values below are measured executions in this session's Linux container. The capacity and calibration inputs are authored reference workloads.

| Exercise | Observed result |
|---|---|
| Closed-form completely mixed reach; dense augmented-matrix comparison | Agreement within 1e-12 numerical tolerances |
| Four-reach, 20-day nitrogen/phosphorus transport and attribution | Conserved-basis residuals near floating-point precision; source superposition closes |
| Interrupted day-8 calculation resumed through day 20 | Sample and mass-budget records exactly match the uninterrupted run |
| 36-record parameter recovery with separate holdouts | Recovers 0.23/day reaction rate and 12.3 kg/day source loading |
| 512 full-network parameter-prior draws / 18,432 predictions | 6.022 seconds; maximum relative budget residual 1.48e-15 |
| 20,000 reaches / 80,000 chemical states / 20,000 independent source tags | 2.205 seconds; peak RSS 305,240 KiB; maximum relative budget residual 2.84e-16 |
| Original retained-source core integration fixture | Complete originals and two completed runs received, reopened, independently edited and re-exported; sender unchanged |
| Chromium with a live native-adapter contract driver | Scenario opening, real mass-budget pagination, observation CSV parsing and new-scenario handling pass with no browser errors |

The large-network operator contains 199,996 nonzero entries. Source attribution storage keeps 20,000 nonzero source-state values for its 20,000 sources, instead of allocating one 80,000-element dense vector per source. Parameter derivatives are assembled from coefficients, avoiding per-parameter duplicate model compilation and numerical differencing of large background rates.

The native/storage journey used a source-level retained-source reference core derived from the read original Workspace methods. The browser journey used Chromium and the live model adapter through the original operator's API contract driver. The scripts accept a supplied original application for further composition runs. `tests/native_journey.py` and `tests/browser_journey.py` name that application explicitly; neither substitutes an InVEST run for a chemistry calculation.

```sh
python -m unittest discover -s tests -p 'test_*.py'
PYTHONPATH=. python tests/capacity.py 20000
python tests/native_journey.py /path/to/native/application
python tests/browser_journey.py /path/to/native/application
```

## Numerical references

SciPy's sparse matrix exponential action: https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.expm_multiply.html

SciPy bounded nonlinear least squares: https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.least_squares.html

EPA WASP water-quality modeling context: https://www.epa.gov/hydrowq/water-quality-analysis-simulation-program-wasp

The implemented model contract and equations above define this contribution; the reference is context, not an EPA certification or a claim of reproducing every WASP model.
