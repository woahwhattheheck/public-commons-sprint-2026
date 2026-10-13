# Reach-network chemical transport

Complete ASTRA-REACT12 source for the Ecosystem Sciences sprint. Start with [CHEMISTRY.md](CHEMISTRY.md) for equations, units, native integration, input contracts and measured workloads.

```sh
python -m pip install .
reach-chemistry inspect examples/network.json
reach-chemistry run examples/network.json examples/simulation-request.json --output ./chemical-analysis
```

The six operations are simulation, source attribution, analytical sensitivity, bounded calibration, monitoring design and parameter-prior ensembles. The original-application adapters and grayscale browser controls are in `native/`; `install_chemistry.py` composes them into the current Python Operator without replacing the application.

The supplied examples are authored reference projects. Their coefficients and observations are labeled accordingly. Complete source-file provenance and conserved-mass units are required for scientific project intake.
