# Interpreting the published regional coefficient alternatives

The published tables make materially different assumptions about the same land-cover transitions. Carry these differences into the signed native comparisons and the scientific review. The strongest examples are pasture-to-grassland phosphorus loading and the erosion factors assigned to developed land.

This analysis uses the exact source tables retained in application merge `edc04b2fae77153f1898c4dd475cee7f82c26e92`. It compares the complete fifteen-class Georgia 2019 / Duke Forest 2022 regional reference, the complete fifteen-class Albright et al. 2023 table, and the Upper Flint 2024 combined alternative after its nine mapped nonurban classes are applied to that regional reference.

## What the complete comparison contains

- `coefficient-comparison.csv`: 120 rows, one for each of fifteen NLCD classes and eight numerical fields. Each row preserves the three source values, units, ratios to the regional reference and the Upper Flint mapping status.
- `transition-coefficients.csv`: 24 rows, covering eight directed transitions under each of the three coherent table choices. The rows include original and destination N/P loads, retention efficiencies and lengths, and the product of the USLE C and P factors.
- `coefficient-comparison-manifest.json`: exact original source hashes, model-field definitions, row counts, calculation methods and derived-file hashes.

Albright changes **101 of the 120 numerical cells** relative to this regional table. Upper Flint combined changes **16 of those cells**: three N loads, two P loads, three N retention efficiencies and eight USLE C values. Its profile targets more cells because it deliberately assigns a coherent published row even when some values already agree.

Upper Flint keeps the original regional rows for water 11, developed 21–24 and emergent wetland 95. Its five original developed imperviousness categories remain in the preserved supplement; the current alternative uses the explicit nine-class mapping in `source/upper-flint-2024/nlcd-mapping.json`.

## The steep-restoration components have different nutrient assumptions

The regional study's steep-restoration case combines crop 82→mixed forest 43 and pasture 81→grassland 71. These two components deserve separate interpretation before their actual combined native effect is read.

| Transition and input | Regional reference | Albright 2023 | Upper Flint combined |
| --- | --- | --- | --- |
| Pasture 81→grass 71, N load (kg/ha/year) | 6.28→5.67; −9.71% | 3.1→3.1; unchanged | 6.28→3; −52.23% |
| Pasture 81→grass 71, P load (kg/ha/year) | 1.35→0.15; −88.89% | 0.1→0.4; +300% | 1.35→0.15; −88.89% |
| Crop 82→mixed 43, N load (kg/ha/year) | 12.42→2.2; −82.29% | 10→1.54; −84.60% | 12.42→2.1; −83.09% |
| Crop 82→mixed 43, P load (kg/ha/year) | 2.21→0.275; −87.56% | 0.99→0.275; −72.22% | 2.21→0.286; −87.06% |

In the Albright pasture-to-grassland change, P retention efficiency is 0.5 in both rows and P critical length is 150 m in both rows. N loading is unchanged while N retention efficiency increases from 0.8 to 0.9. The scenario name alone therefore cannot determine the sign of every nutrient response. Read the actual retained, routed NDR output for each constituent and each spatial alternative.

The combined steep-restoration effect also depends on the actual converted area of each component, its location in the flow network, the rest of the contributing landscape and the selected native parameters. The existing study engine retains actual changed cells and paired support for that comparison.

## Developed-land erosion factors reverse the input contrast

USLE gross erosion contains the product `R × K × LS × C × P`. The ratios below isolate **C×P at a converted cell with the other factors held fixed**. Native SDR subsequently routes sediment using its own delivery calculation.

| Transition | Regional reference C×P | Albright 2023 C×P | Upper Flint combined C×P |
| --- | --- | --- | --- |
| Deciduous 41→low development 22 | 0.001→0.05; 50× | 0.009→0.00003; 1/300 | 0.002→0.05; 25× |
| Evergreen 42→low development 22 | 0.001→0.05; 50× | 0.004→0.00003; 0.0075× | 0.002→0.05; 25× |
| Mixed 43→low development 22 | 0.001→0.05; 50× | 0.007→0.00003; 0.004285714286× | 0.002→0.05; 25× |
| Crop 82→mixed 43 | 0.2→0.001; 0.005× | 0.12→0.007; 0.058333333333× | 0.17→0.002; 0.011764705882× |
| Pasture 81→grass 71 | 0.01→0.01; 1× | 0.05→0.004; 0.08× | 0.07→0.04; 0.571428571429× |

Albright's developed rows use P=0.001; low development has C=0.03 and medium development has C=0.02. The regional table uses P=0.5 and C=0.1 for those rows. These exact published choices explain the opposite C×P input directions. The Albright high-intensity row also has C=0.

Keep the published coefficients as named alternatives and preserve the signed native sediment change. A sediment reduction under the Albright development scenario should be interpreted alongside its exact C/P assumptions and the native routing result.

## Retention and model parameters must travel with the loads

Albright uses 150 m critical lengths for both nutrients in all fifteen classes; the regional and mapped Upper Flint rows use 30 m. The fivefold length difference accompanies changed class retention efficiencies. A ratio of loading coefficients alone cannot explain the full NDR response.

The current retained regional table has nitrogen subsurface proportion 0 for every class. The Albright alternative preserves those values, and the mapped Upper Flint nutrient rows also specify 0. This particular reference-table comparison therefore exercises the surface nutrient pathway. The Vickery–Quinn profile still preserves its reported nitrogen subsurface settings as part of the coherent source definition; their effect depends on the actual selected baseline's subsurface fractions.

The table-only Albright alternative retains the selected baseline's native parameters. The Albright–Vickery alternative applies the eight reported Vickery–Quinn settings together. The three Upper Flint specifications isolate the nutrient columns, the sediment columns, or both while retaining the baseline's other settings. All these choices remain accessible through the existing study-profile command.

A materialization run initialized with the provided regional-reference bootstrap already gives its baseline the Vickery–Quinn native settings. In that specific setup, the Albright table-only and Albright–Vickery choices have the same scientific settings. Preserve their source descriptions and use the maintained engine's actual input signatures and completed-stage reuse when counting distinct native calculations.

## How to use this in the regional study

Use the existing `source_tools.upstate_study_profiles` programme and each profile's own baseline. For the six named choices and seven spatial alternatives, the declared programme has up to 48 named cases before equivalent native work is reused. The actual programme records establish its case IDs, unique source signatures and completed calculations.

For each completed scenario, read the N, P and sediment signs separately, the actual changed area and the paired valid-cell support. Connect a sensitivity result to the complete source choice: table loads, retention, C/P and native parameters. The prepared CSVs make that inspection reproducible; the native run outputs supply the routed annual masses.

The original baseline, reporting mask, model domain and scenario allocation must remain the same across the profile comparison. Interpret spatial-placement effects within a profile separately from coefficient effects on the same retained scenario. Use the original study report's support groups when valid-cell coverage differs.

## Source attribution and exact retained inputs

1. Regional reference: Georgia 2019 Table A1 nutrients and Duke Forest 2022 Table 4 sediment, `source/biophysical-regional-20261012/regional-biophysical.csv`; SHA256 `b2b5778c5d8c71b2b0c6db370f29a60e987d1be3d491cec91493a0b975b8b9e4`. Original references: [Georgia 2019](https://doi.org/10.3390/environments6050052) and [Duke Forest 2022 source](https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download). The adjacent source manifest retains their complete provenance.
2. Albright, Vickery, Bower and Quinn 2023, Appendix 1; `source/regional-studies-20261013/albright-2023-biophysical.csv`; SHA256 `64c5c803e09d50d9f51c029ece199a06c01d19951ae3fdce52b7fca7bb13bf8c`. [Original paper](https://doi.org/10.1080/1747423X.2023.2234903).
3. Abbasnezhad, Abrams and Wenger 2024, original supplement; `source/upper-flint-2024/nlcd-nonurban-coefficients.csv`; SHA256 `ba2e1b14ab77f7b327f1124d9b489a81b783c84b71176eb665365d899e27665d`. [Original paper](https://doi.org/10.3390/land13060893) and [complete supplement](https://www.researchgate.net/publication/381634619_land-2997438-supplementarypdf).
4. Vickery and Quinn 2023, Appendices 1–2, retained in `study-definitions.json`. [Original parameter and transition rules](https://doi.org/10.1007/s00267-023-01861-6).
5. Current model interpretation: official [InVEST 3.20 NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).

Ratios are destination/source; changes are destination−source. A zero denominator is empty in the ratio column. CSV ratios are rounded to twelve significant digits; the original source value strings remain in the corresponding input columns. Both independent source analyses agreed on all 101/16 changed numerical cells and the highlighted transition calculations.
