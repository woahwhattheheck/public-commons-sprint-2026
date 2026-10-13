# Standalone simulated headwaters calculation

Editable synthetic 120 x 120, 30 m headwaters case (12.96 square kilometres): baseline, riparian pasture-to-forest alternative and matched control. The runner calls the existing official InVEST 3.20.0 NDR and SDR implementations for six native calculations. It installs no packages. Its inputs are illustrative assumptions, not observed or calibrated field measurements.

Use the actual equipped scientific Python:

```sh
EXISTING_SCIENTIFIC_PYTHON -u simulated_headwaters_direct.py --root /owned/simulated-headwaters-direct --config simulated_headwaters_direct.config.json
```

`--prepare-only` requires the existing NumPy, Rasterio, Fiona and Shapely environment and constructs inputs without claiming native execution. Full execution additionally requires the existing official `natcap.invest==3.20.0` runtime and its GIS dependencies. Inspect actual progress/logs and completed native outputs; `OPEN_RESULTS.html` is written from the resulting comparison. Keep the strict October 13, 2026 14:00 UTC cutoff. This source publication is not a completed native-run receipt.
