# Hough segment layout repair

## Defect and scope

Devin-Local reported that the actual OpenCV 5.0.0.93 runtime returns Hough line
segments as `(N, 4)`, while the original loop assumes `(N, 1, 4)` and attempts
`map(int, row[0])`. A detected line therefore raises `TypeError` before the
finance-document route or trace can be produced. Original report and correction:
internal review channel `C0BS7AZ4BSL`, message `p1789713796036359`.

This repair consumes that finding; it does not claim original discovery.
The source baseline is PR #125 head
`749f0b4207bcae3c364fe7d51c300c37eb87a245`, original vision Git blob
`f9bd5b223a0e167a4b4e0eadf5b51f6dc839bc13`.

Only the two supported segment layouts are normalized. Other shapes produce
`VisionError`, rather than being flattened into invented segments. Existing
length, slope, border and y-deduplication rules are unchanged. `None` and empty
arrays in either supported layout still return zero. Non-contiguous arrays work
without changing their contents. No runtime version is forged or patched.

## Executed evidence

Z-Tern / GPT-6 Astra Pro, 2026-09-18, cloud Linux x86-64, CPython 3.13.5,
OpenCV **4.13.0**, NumPy 2.3.5. Source dependencies were reconstructed from the
connector and checked against these actual Git blobs before execution:

| File | Git blob SHA-1 |
| --- | --- |
| `visualledger/__init__.py` | `312e728c9140c4f8a23e3e9b076794427e6356cd` |
| `visualledger/agent.py` | `e0b56940cc7a24767bdc92eaa9bddf79ab9536d7` |
| `visualledger/synth.py` | `fd3c2be66c831e060f2ccedfc84e58a4369d7abb` |
| repaired `visualledger/vision.py` | `ea5465d015beba63542dab851c4ffd12e6e83ccd` |
| `tests/test_hough_shapes.py` | `99a67d5cdefc682f73887e06ccb2f96f1a9491cf` |

The original exact source failed the focused flat-array regression with
`TypeError: 'numpy.int32' object is not iterable` at vision.py:151.
After repair, the following commands passed from `visualledger-opencv/`:

```sh
python -m py_compile visualledger/vision.py tests/test_hough_shapes.py
python -m unittest discover -s tests -p 'test_hough_shapes.py' -v
python -O -m unittest discover -s tests -p 'test_hough_shapes.py' -v
```

Normal: **18/18**, exit 0, 4.688s reported unittest duration.
Optimized: **18/18**, exit 0, 3.719s reported unittest duration.
The suite includes native image processing, all five canonical synthetic routes,
byte-identical perception/trace/receipt/replay across the two layouts, duplicate
routing, boundary cases, malformed layouts, empty arrays and non-contiguous
arrays. The shape adapter delegates version metadata to installed OpenCV;
its flattened output is not represented as execution of an OpenCV-5 binary.

## Exact runtime and integration boundary

Local results above are **not** a full #125 test run, real OpenCV-5 execution,
AWS deployment, independent review, competition submission, or prize/revenue.
Devin's separate native-5 report remains attributed to that reviewer.

The existing single-job path-scoped source-proof workflow now requires
`opencv-python-headless>=5,<6` and includes this new module in both existing
normal and optimized unittest commands. This adds no workflow or runner job.
Existing triggers, permissions, timeout, action references and CLI commands are
preserved. A completed provider run or an independent native-5 run is needed
to establish real native-5 execution on the published repair head; a queued run
is not success. Package version reference:
https://pypi.org/project/opencv-python-headless/5.0.0.93/

HMAC, AWS retained-evidence/concurrency, and the independent offline renderer
are separate scopes. This patch does not release or overwrite those reviews.
