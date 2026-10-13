# Regional NLCD biophysical reference

This edition joins the original 15-class Georgia 2019 Appendix A1 nutrient table to the 15-class sediment table in **Ecosystem Service Analysis of Duke Forest**, Shouta Hayashi and Eamon Horrigan, **2022**, Table 4. Both publications use the same integer NLCD class codes. The combined CSV preserves every published numeric string and both sets of class labels.

## Native model inputs

`regional-biophysical.csv` supplies the current model's exact twelve required columns plus the two original class labels. Nitrogen and phosphorus loads are kg/ha/year, retention efficiencies are ratios, and C/P factors are dimensionless. Appendix A1's NLCD footnote supplies 30 m nitrogen/phosphorus critical retention lengths and zero subsurface nitrogen fraction. The separate GlobCover A2 table has its own 290 m constant; this edition uses A1.

The Georgia loads are published land-cover export coefficients. The current native InVEST interface therefore records their basis as `measured-runoff` for both nutrients. Original A1 values remain unchanged. The saved model profile separately retains selected NDR/SDR algorithm parameters, source periods and calibration observations.

## Source interpretation

The Georgia publication is Benez-Secanho and Dwivedi (2019), *Does Quantification of Ecosystem Services Depend Upon Scale (Resolution and Extent)? A Case Study Using the InVEST Nutrient Delivery Ratio Model in Georgia, United States*, DOI [10.3390/environments6050052](https://doi.org/10.3390/environments6050052). Its original application uses NLCD 2006 and InVEST 3.4.2 across 57 Georgia watersheds. The retained A1 CSV and provenance match the original captured source exactly.

The [Duke Forest report](https://dukespace.lib.duke.edu/bitstreams/57c6d8cb-9ce3-4740-b1d5-39c92bda284c/download) attributes its Table 4 estimates to Hamel et al. (2015), DOI [10.1016/j.scitotenv.2015.04.027](https://doi.org/10.1016/j.scitotenv.2015.04.027). The selected C/P values are the Duke report's published regional application. Its authors' [March 29, 2022 project presentation](https://storymaps.arcgis.com/stories/ae40930c3caa4ba38005a1ab7da083a7) and [university advisor bibliography](https://sites.nicholas.duke.edu/nicolettecagle/cagle-lab/people/) retain the original year.

For cultivated crops, Duke Table 4 publishes C = **0.2**. The [2017 Cape Fear discussion](https://repository.library.noaa.gov/view/noaa/57797/noaa_57797_DS1.pdf), DOI 10.1016/j.scitotenv.2016.12.103, discusses agricultural corn with C = **0.25**. This reference edition selects the Duke table intact. An experiment selecting the Cape Fear value should retain that attribution as a separate profile so comparisons identify exactly which source choice changed.

## Reproduce and use

`rebuild.py` reads the two retained CSVs, checks their exact original Git blob identities, requires all fifteen unique class codes, and writes the combined CSV plus row/field lineage. It uses only Python's standard library.

```sh
python -B rebuild.py --source . --output /absolute/new-regional-rebuild
```

Import `source-manifest.json` through the existing operator's source intake. Select the retained `regional-biophysical` table when creating a named model profile. The source collection, table hash, algorithm parameters and run selections then travel through the original Workspace, native model outputs, comparison and delivery archive.
