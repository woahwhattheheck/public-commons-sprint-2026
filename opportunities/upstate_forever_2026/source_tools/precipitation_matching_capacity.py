"""Replay the declared full-population numerical capacity workload on Linux."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import resource
import sys
import time
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from precipitation_matching import match_precipitation

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--targets', type=int, default=1_000_000)
    parser.add_argument('--candidates', type=int, default=4_000_000)
    parser.add_argument('--seed', type=int, default=20261013)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 0 <= args.targets <= args.candidates:
        parser.error('Require 0 <= targets <= candidates')
    if args.output.exists():
        parser.error('Output already exists; retain the previous measurement')
    rng = np.random.Generator(np.random.PCG64(args.seed))
    a = rng.uniform(1000, 1600, args.targets)
    b = rng.uniform(1000, 1600, args.candidates)
    start = time.perf_counter()
    result = match_precipitation(a, b)
    elapsed = time.perf_counter() - start
    if np.unique(result.candidate_positions).size != args.targets:
        raise ArithmeticError('Candidate identities are not distinct')
    out = {**result.metadata(), 'workload': 'PCG64 uniform rainfall algorithm capacity',
           'seed': args.seed, 'range_mm_year': [1000,1600],
           'elapsed_seconds': elapsed,
           'peak_process_rss': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
           'peak_process_rss_unit': 'bytes' if sys.platform == 'darwin' else 'KiB',
           'platform': sys.platform, 'python': sys.version, 'numpy': np.__version__,
           'target_sha256': hashlib.sha256(a.tobytes()).hexdigest(),
           'candidate_sha256': hashlib.sha256(b.tobytes()).hexdigest(),
           'assignment_sha256': hashlib.sha256(result.candidate_positions.tobytes()).hexdigest(),
           'legacy_backtracking_bytes': (args.targets+1)*(args.candidates+1),
           'kernel_sha256': hashlib.sha256((HERE/'precipitation_matching.py').read_bytes()).hexdigest()}
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(out, stream, indent=2, allow_nan=False);stream.write('\n')
    print(json.dumps(out, indent=2, allow_nan=False))

if __name__ == '__main__':
    main()
