# Upper Savannah annual reference editions

The seven original tributary targets used by the retained P9 candidate course agree with the selected F7 annual-load estimates at the P9 mapper's four-decimal precision. The F7 source adds the selected estimator, its published standard error, station-specific water-quality dates and original sampling counts. The seven targets cover three retained reach catchments: Chattooga, Stevens Creek and Broad River.

The full eleven-record source remains in [original-target-records.json](original-target-records.json). The original publisher dictionary is [F7DN436B-original-metadata.xml](F7DN436B-original-metadata.xml). The original source editions are [USGS P9A682GW](https://doi.org/10.5066/P9A682GW) and [USGS F7DN436B](https://doi.org/10.5066/F7DN436B).

## What the source adds

| Catchment | Parameter | Original annual estimate | Published standard error | Relative standard error | Unit | Selected estimator |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Chattooga | Total nitrogen | 270438.43812 | 37653.632764 | 13.92% | kg/year | Beale |
| Stevens Creek | Total nitrogen | 139789.36422 | 14901.219181 | 10.66% | kg/year | Beale |
| Chattooga | Total phosphorus | 96111.004177 | 27606.416996 | 28.72% | kg/year | Beale |
| Broad River | Total phosphorus | 223025.1307 | 35113.532598 | 15.74% | kg/year | Beale |
| Stevens Creek | Total phosphorus | 19086.989602 | 3923.902867 | 20.56% | kg/year | Fluxmaster, detrended |
| Chattooga | Total suspended solids | 7201.8484036 | 1260.3312444 | 17.50% | metric tonnes/year | Beale |
| Broad River | Total suspended solids | 141611.90585 | 25753.711093 | 18.19% | metric tonnes/year | Beale |

Every value in this table comes from the selected final estimator in the retained original record. Beale selects rload_a_XXXXX and serload_a_XXXXX. Fluxmaster selects LOAD_A_XXXXX and SLOAD_A_XXXXX. The original archives express all values and standard errors in kg/year. Both sediment columns above are divided by exactly 1000 for comparison with the original P9 ACTUAL_MT target. TSS 00530 remains distinct from suspended sediment 80154.

A standard error describes uncertainty in its annual reference estimate. The values support a deterministic sensitivity analysis around the published estimates. A distribution, probability or confidence level requires further assumptions; the current native sensitivity engine instead evaluates an explicitly selected multiple of each published standard error.

The largest difference between the two displayed source editions is the Broad River TSS target: the retained mapper contains 141611.9058 metric tonnes/year, while the original annual estimate is 141611.90585. That difference is exactly half a mapper display quantum. All seven changes are less than three billionths of their respective published standard errors. The review performs this comparison with decimal arithmetic, including the exact halfway value.

## Time and sampling

The flow period for all seven annual estimates starts on 1 October 1999 and includes 30 September 2014. The importer records its exclusive end as 1 October 2014. These are annual rates, so the length of the flow period does not multiply their values.

The release has a 2012 reference base year. Six selected Beale estimates are the published long-term means. The selected Stevens Creek phosphorus estimate uses Fluxmaster detrending. Each original method and detrending flag travels with its record.

| Catchment and parameter | Water-quality sampling window, inclusive | Original sample count | Censored sample count |
| --- | --- | ---: | ---: |
| Chattooga nitrogen | 1999-10-13 to 2014-09-22 | 167 | 106 |
| Stevens Creek nitrogen | 2000-01-17 to 2013-07-11 | 110 | 21 |
| Chattooga phosphorus | 1999-10-14 to 2014-09-22 | 205 | 153 |
| Broad River phosphorus | 2002-01-09 to 2013-06-11 | 30 | 3 |
| Stevens Creek phosphorus | 2001-06-25 to 2013-07-11 | 120 | 29 |
| Chattooga TSS | 1999-10-14 to 2014-09-22 | 170 | 37 |
| Broad River TSS | 2002-01-09 to 2013-06-11 | 29 | 2 |

These counts describe the samples underlying the published load estimation. For example, 153 of 205 original Chattooga phosphorus samples are censored. The published estimator and its standard error are retained together; the preparation does not reinterpret censored samples or recompute their load estimator.

The station, constituent, COMID, period and numerical correspondence support treating P9 and F7 as related reference editions. A successor source review preserves the original training and validation groups. The additional source information improves interpretation of an existing comparison; it does not create new independent validation observations.

## Catchment identity

Preparation reuses the six original retained NLDI feature and basin responses for these COMIDs:

| Catchment | Original reach COMID | Original catchment ID |
| --- | --- | --- |
| Chattooga | 6269342 | d6a97f6c3d3a4951b1e1819e117bf27d182259596a3a14af0728ed66a8ef93c5 |
| Stevens Creek | 11730084 | c09358d30c690db19c117274400e28e15b4ea2e60cb0c3e30f420a6e44b47af7 |
| Broad River | 6280111 | 4c39889618c8345116860a8f829022b2f606ebd681f4a374e1adc4f9b7ebe658 |

Each retained basin uses the original full catchment convention and original component selection. Source publication changes the observation edition while preserving those original geometries.

The Stevens Creek source is a useful example of why station roles remain explicit. Its water-quality station is scSV-354, published reach is COMID11730084, and paired flow gauge is 02196000. The original station drainage area is 1470.2265 km², while the published gauge drainage area is 1411.55 km². The prepared reference continues to use the selected original reach basin.

The four additional source records are nitrogen and phosphorus at scSV-366 and scSV-368, on COMIDs22724211 and22726623. Their complete original records remain available for broader regional work. They have separate upstream catchments from the three retained tributary groups.

## Generate the complete review

From the existing application directory:

~~~bash
python -B -m source_tools.annual_reference_bridge \
  --preset source/usgs-southeast-sparrow-2012/candidate-course.json \
  --targets source/usgs-annual-2012/upper-savannah/original-target-records.json \
  --output /mnt/data/upper-savannah-annual-reference-review
~~~

The command uses Python's standard library. It verifies both original input file hashes, joins exact station/parameter/reach identities, checks the original periods and units, computes decimal comparisons and writes three complete outputs:

- reference-edition-bridge.json: all seven source matches, exact decimal comparisons, source identities and all eleven original records.
- reference-edition-bridge.csv: the seven selected targets with units, methods, uncertainty, source and gauge identifiers, periods, counts and original member/record references.
- reference-edition-bridge.html: a readable grayscale review with source comparisons, station periods, drainage areas and expandable original records.

Repeating the command accepts identical completed outputs. New or changed review content belongs in a new output directory. Final files are published atomically; concurrent or interrupted writes preserve completed content.

## Prepare and use the F7 observation edition

[PREPARE_F7.md](PREPARE_F7.md) contains the complete retained-archive and six-original-basin preparation procedure. It uses the existing source_tools.usgs_annual importer and the original Workspace binding. The successor retains the full eleven-record source as context and selects the seven original tributary comparisons in their established order.

The native source-error review consumes original completed candidate predictions and the selected published errors. It retains the original source, annual units, spatial groups and training-derived normalization. Its report records the exact P9-to-F7 correspondence alongside the source-error sensitivity result.

Original native runs retain their own terrain, land-cover, climate and parameter editions. The successor observation source becomes an additional editable scientific input, with the original archive, dictionary, rows and catchments available for export and reopening.
