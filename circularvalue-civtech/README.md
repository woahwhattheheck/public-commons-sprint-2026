# CircularValue

Evidence-first CivTech 12.3 prototype.

Run:

```bash
python -m compileall -q circularvalue tests
PYTHONPATH=. python -m unittest discover -s tests -v
PYTHONPATH=. python -O -m unittest discover -s tests -v
PYTHONPATH=. python -m circularvalue.cli demo --out-dir /tmp/circularvalue-demo
PYTHONPATH=. python -m circularvalue.cli verify /tmp/circularvalue-demo/case.json /tmp/circularvalue-demo/packet.json
```

The demo uses synthetic data. Each scenario input is bound to retained evidence hashes, explicit confidence labels, deterministic replay and bounded uncertainty.
