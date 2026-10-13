# Upper Flint 2024 regional reference profiles

These files add a coherent published coefficient alternative to the current source-backed experiment workflow. They include the original nutrient and erosion data, its explicit NLCD mapping, and NDR, SDR and combined factor specifications.

Source: Abbasnezhad, Abrams and Wenger (2024), *Land* 13(6),893, DOI 10.3390/land13060893. Original author supplement: https://www.researchgate.net/publication/381634619_land-2997438-supplementarypdf . The numerical input records come from Tables S2/S3 and their adjacent factor definitions. The source is attributed under the article's CC-BY-4.0 license.

## Integration

Install beside the existing application, retaining `model/experiment_profiles.py` from current Canvas F0C8JN2V0G5. Bind the actual receiving baseline profile ID before calling its ordinary API:

```python
import json
from pathlib import Path
from model import experiment_profiles

spec = json.loads(Path("source/upper-flint-2024/profile-combined.json").read_text())
spec["baseline_profile_id"] = actual_baseline_profile_id
preview = experiment_profiles.preview(workspace, spec)
profiles = experiment_profiles.materialize(workspace, spec)
```

Every factor has one level and the design is factorial. The resulting candidate therefore applies the complete selected reference together. The profile engine includes the retained baseline and deduplicates identical resulting values. The NDR, SDR and combined specifications let the same source choice enter the corresponding native programme.

To add the choice to an existing experiment:

```python
selection["axes"] = []
composed = experiment_profiles.selection_with_profiles(workspace, selection, spec)
from model import experiments
experiment = experiments.prepare(workspace, composed["selection"])
```

Keep other independently studied profile IDs in `selection.profile_ids`. Use `model.experiment_programme_bridge.materialize_cases` or the current programme controller to prepare and execute the native cases. Completed model stages remain reusable through the existing native cache.

## Mapping decisions

The reference targets nine NLCD codes: 31,41,42,43,52,71,81,82,90. The published combined forest row maps to 41/43; the combined shrubland/herbaceous row maps to 52/71. The receiving baseline supplies the other rows. This explicit adaptation permits the alternative to use the actual regional raster and complete retained table.

The original supplement has five developed imperviousness labels. `published-biophysical.csv` preserves those original coefficients. Their original numeric bin thresholds are needed for a precise urban raster mapping. The water row also preserves the source's printed zero critical lengths; the receiving water row continues to supply the active model values.

The two modern `load_type` fields are compatibility adaptations: `measured-runoff` makes InVEST 3.20 use the published coefficients directly. Its `application-rate` option would multiply loading by on-pixel nonretention. This choice preserves the numerical meaning of these historical NDR inputs and is retained with each modified cell's rationale. Current definition: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html .

## Files

- `published-biophysical.csv`: thirteen source-category records with original N/P, retention length, cover and support coefficients.
- `nlcd-nonurban-coefficients.csv`: the explicit regional table projection.
- `nlcd-mapping.json`: source-row and NLCD relationships.
- `profile-ndr.json`, `profile-sdr.json`, `profile-combined.json`: exact current profile-engine factor specifications.
- `source-metadata.json`: original source, units, extraction, compatibility decisions and receiving engine identity.

The factors retain field-specific references and reasons, and the existing engine carries original and selected cell values, table identities, source collections and profile IDs through the native experiment.
