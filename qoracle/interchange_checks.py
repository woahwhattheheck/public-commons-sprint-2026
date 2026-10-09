"""Focused acceptance cases for QASM interchange and finite-shot sampling."""
import copy
import json
import math
import random
import unittest

from .engine import OracleError, simulate
from .qasm import dump_qasm, load_qasm
from .shots import sample

HEADER = 'OPENQASM 2.0; include "qelib1.inc"; '


class InterchangeChecks(unittest.TestCase):
    def test_bell_roundtrip_and_ordered_measurement(self):
        source = HEADER + 'qreg a[1]; qreg b[1]; creg c[2]; h a; cx a,b; measure\tb -> c[0]; measure a -> c[1];'
        manifest = load_qasm(source)
        self.assertEqual(manifest['probability_wires'], [1, 0])
        self.assertEqual(load_qasm(dump_qasm(manifest)), manifest)
        report = simulate(manifest)
        self.assertAlmostEqual(report['probabilities'][0], 0.5)
        self.assertAlmostEqual(report['probabilities'][3], 0.5)
        permuted = load_qasm(HEADER + 'qreg q[2]; creg c[2]; x q[0]; measure q[1]->c[0]; measure q[0]->c[1];')
        self.assertEqual(simulate(permuted)['probabilities'], [0, 0, 1, 0])

    def test_rotations_broadcast_u_and_swap_export(self):
        manifest = load_qasm(HEADER + 'qreg q[2]; h q; rx(pi/2) q[0]; ry(-(pi/4)) q[1]; rz(1e-2) q[0]; cz q[0],q[1];')
        self.assertEqual(len(manifest['gates']), 6)
        self.assertEqual(load_qasm(dump_qasm(manifest)), manifest)
        phase = load_qasm('OPENQASM 2.0; qreg q[1]; U(pi/2,pi/2,0) q[0];')
        phase['observables'] = ['Y']
        self.assertAlmostEqual(simulate(phase)['expectations']['Y'], 1.0)
        swap = {'schema': 1, 'qubits': 2, 'gates': [{'op': 'X', 'wire': 0}, {'op': 'SWAP', 'wire_a': 0, 'wire_b': 1}], 'observables': []}
        restored = load_qasm(dump_qasm(swap))
        self.assertEqual(simulate(swap)['probabilities'], simulate(restored)['probabilities'])

    def test_rejects_unsupported_or_lossy_programs(self):
        invalid = [
            'qreg q[1]; reset q[0];',
            'qreg q[1]; creg c[1]; measure q->c; x q[0];',
            'qreg q[1]; rx(1/0) q[0];',
            'qreg q[1]; rx(1e999) q[0];',
            'qreg q[1]; creg c[2]; measure q[0]->c[0];',
            'qreg q[2]; cx q[0],q[0];',
        ]
        for source in invalid:
            with self.subTest(source=source), self.assertRaises(OracleError):
                load_qasm(HEADER + source)
        with self.assertRaises(OracleError):
            load_qasm('OPENQASM 2.0; include "local-secrets.inc"; qreg q[1];')
        with self.assertRaises(OracleError):
            dump_qasm({'schema': 1, 'qubits': 1, 'gates': [], 'observables': ['Z']})

    def test_sampling_repeatability_support_and_no_mutation(self):
        manifest = load_qasm(HEADER + 'qreg q[2]; h q[0]; cx q[0],q[1];')
        before, rng_before = copy.deepcopy(manifest), random.getstate()
        first = sample(manifest, 4096, 62)
        self.assertEqual(first, sample(manifest, 4096, 62))
        self.assertEqual(sum(first['counts']), 4096)
        self.assertEqual(first['counts'][1:3], [0, 0])
        self.assertEqual(first['bitstring_counts']['11'], first['counts'][3])
        self.assertEqual(manifest, before)
        self.assertEqual(random.getstate(), rng_before)
        # Trailing zero bins must remain impossible for a deterministic circuit.
        basis = load_qasm(HEADER + 'qreg q[2]; x q[0];')
        self.assertEqual(sample(basis, 64, 0)['counts'], [0, 64, 0, 0])
        with self.assertRaises(OracleError):
            sample(manifest, True, 0)
        with self.assertRaises(OracleError):
            sample(manifest, 64, -1)
        json.dumps(first, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
