# Measured observations → original chemistry inference

ASTRA-OBS12 · 1.0.0 · Internal Upper Savannah source companion

This additive consumer connects the complete ASTRA-OBS12 measurement export to ASTRA-REACT12's actual sparse-network calibration engine. It preserves the entire input population, excluded records, sample and source identifiers, species/fraction/basis decisions, native-to-network reach mapping, model-day origin or explicit time assignments, uncertainty weights, fit/holdout roles and original project edition. The original measurement writer, scientific model, solver, queue and report writer remain in place.

## Install in the maintained application

Install both original components, then run:

```sh
python install_chemistry_binding.py --application /absolute/current/upstate_forever_2026
```

This adds only `measurement_workspace/chemistry.py` and `MEASUREMENT_CHEMISTRY.md`. Identical reruns reuse them; different authored files are preserved. The consumer resolves the native `model.reach_chemistry` namespace when installed, or the original `reach_chemistry` standalone SDK. The chemistry component supplies its existing NumPy/SciPy dependencies and Python 3.11+ requirement.

## Source-bound workflow

Export the complete reviewed calibration population from **Measured observations**, and retain the selected original chemistry case's project JSON. Create the explicit binding plan:

```sh
python -m measurement_workspace.chemistry plan \
  --measurements measured-inputs.json --project original-chemistry-project.json \
  --output binding-plan.json
```

The generated plan includes every source measurement plus the actual target species and reaches. Fill its reviewer/rationale, model origin, original parameter selections, species bindings, spatial bindings and per-record choices. These are editable scientific inputs, not a new publication or approval gate. Choices can be produced by the original application, another program or the operator. Example shapes (replace all example names with the retained identifiers):

```json
{
  "reviewer": "Study analyst",
  "rationale": "Study-specific chemical observation mapping",
  "origin_utc": "2026-01-01T00:00:00Z",
  "species_bindings": {
    "original_species_id": {
      "parameter": "nitrate", "basis": "N", "fractions": ["Dissolved"],
      "rationale": "The selected state represents dissolved nitrate measured as nitrogen"
    }
  },
  "reach_bindings": {
    "original_native_id": {
      "reach": "original_model_reach", "rationale": "Document the actual monitoring-to-network association"
    }
  },
  "selections": [{
    "measurement_id": "original_measurement_id", "species": "original_species_id",
    "sigma_mg_l": 0.03, "uncertainty_reference": "Study-specific uncertainty or weighting reference",
    "role": "fit", "time": {"mode": "source-instant"}
  }]
}
```

This fragment illustrates field structure; retain the generated schema and source fingerprints, plus the selected original `parameters`. The example sigma is not a default. Each selection must explicitly identify `fit` or `holdout`, a positive sigma and its reference. Unselected records remain in the complete excluded population. The binding validates literal chemical basis and source fraction; it cannot infer the physical meaning of an arbitrary target species name. In particular, a total nutrient is not automatically an individual dissolved species.

For a source lacking an exact sampling instant, a documented time assignment can be supplied per record:

```json
{"mode":"explicit-model-day","day":2.5,"rationale":"Study-specific explanation of the source's temporal association"}
```

Otherwise the source's offset-bearing sampling instant is differenced from the explicit model origin. Date-only samples are not silently converted to midnight. Samples outside the original project's duration stay excluded.

Compile the complete bundle:

```sh
python -m measurement_workspace.chemistry build \
  --measurements measured-inputs.json --project original-chemistry-project.json \
  --plan binding-plan.json --output measured-chemistry-binding
```

Outputs: `binding.json`, original `project.json`, native `calibration-request.json`, grayscale complete `report.html`, and file inventory. The native request contains the full binding as retained metadata, so the original chemistry run/export carries every input, choice and excluded record. The original chemistry browser's **Run request** accepts this request. The unchanged standalone CLI runs it directly:

```sh
python -m reach_chemistry run measured-chemistry-binding/project.json \
  measured-chemistry-binding/calibration-request.json --output saved-chemistry-fit
```

For the existing native case and queue:

```python
from measurement_workspace.chemistry import load, native_payload
from model.chemistry import Chemistry
payload = native_payload(load('measured-chemistry-binding/binding.json'),
                         Chemistry(existing_workspace), existing_case_id)
# Submit payload through the original operator's chemistry.run action.
# Or in its existing worker: Chemistry(existing_workspace).run(payload)
```

`get_case` verifies the original case and its source editions before its project fingerprint is compared to the binding. No replacement case or network is silently created.

## Censoring and source quality

An exact point uses the original `equal` observation residual. A left-censored measurement with an original upper bound uses the solver's existing `below` hinge residual; the original point remains null in its retained source row. No zero/half-limit substitution occurs. Right/interval censoring is kept in the excluded report because that residual is not implemented by the original engine. Qualified, superseded, explicitly rejected, unmapped and otherwise unsuitable source records retain their original exclusion; this consumer does not override their measurement review. Every retained replicate remains separate.

A compiled packet with fewer usable fit observations than parameters remains inspectable with `runnable=false`. The native payload helper requires a runnable selection. No claimed field fit, annual load conversion or regulatory inference is generated by compilation.

## Independent receiving and edits

```sh
python -m measurement_workspace.chemistry receive \
  --binding measured-chemistry-binding/binding.json --output independent-binding
```

Receiving recompiles the full original measurement export, project and plan and compares every result and exclusion, rather than trusting the received request. Repeat receiving to an identical directory reopens it; changed files are preserved. The receiver can edit its retained plan and build a separate successor without changing the sender. The complete original laboratory/provider files remain in the measurement workspace's existing full portable export; this companion retains the complete calibration export and source-row references.

## Executed cross-component journey

```sh
python verification/chemistry_journey.py \
  --measurements /source/ASTRA-OBS12 \
  --chemistry /source/ASTRA-REACT12 \
  --output /new/journey-output
```

This executes both original engines and the original native chemistry CLI/report writer, without substituted scientific functions. The original REACT12 authored recovery observations are encoded as an explicitly labelled WQX-shaped CSV, imported and independently received by the measurement engine, then bound and fitted. The 25-record population retains 19 inputs including a nondetect upper bound, and six explicit exclusions; a documented independent time edit includes one additional record. Nitrification and point-load recovery returns 0.23/day and 12.3 kg/day. Exact source/project changes, request tampering, repeat reopening, complete outputs and independent edits are exercised. This is a cross-component software/reference exercise; original agency samples and the cumulative operator's regional Workspace remain distinct inputs.

## Combined source distribution

The combined 1.2.0 distribution provides `install_chemistry_binding.py` at its root. This compatibility copy differs from the original installer only by reading the retained `MEASUREMENT_CHEMISTRY.md` instead of this distribution’s general README. The byte-exact original installer is retained at `originals/install_chemistry_binding.py`; the original guide, adapter and journey remain unchanged.
