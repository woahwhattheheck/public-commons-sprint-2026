"""Analytic checks for the independent statevector oracle. Not a contest score."""

from __future__ import annotations

import math
import unittest

from engine import OracleError, load_manifest, simulate, verify


def _run(qubits: int, gates: list[dict], observables: list[str] | None = None) -> dict:
    body = {"schema": 1, "qubits": qubits, "gates": gates}
    if observables is not None:
        body["observables"] = observables
    return simulate(load_manifest(__import__("json").dumps(body)))


class OracleRegression(unittest.TestCase):
    def test_bell(self) -> None:
        report = _run(2, [{"op": "H", "wire": 0}, {"op": "CNOT", "control": 0, "target": 1}], ["ZZ", "XX"])
        self.assertAlmostEqual(report["probabilities"][0], 0.5)
        self.assertAlmostEqual(report["probabilities"][1], 0.0)
        self.assertAlmostEqual(report["probabilities"][2], 0.0)
        self.assertAlmostEqual(report["probabilities"][3], 0.5)
        self.assertAlmostEqual(report["expectations"]["ZZ"], 1.0)
        self.assertAlmostEqual(report["expectations"]["XX"], 1.0)

    def test_ghz(self) -> None:
        report = _run(
            3,
            [
                {"op": "H", "wire": 0},
                {"op": "CNOT", "control": 0, "target": 1},
                {"op": "CNOT", "control": 0, "target": 2},
            ],
        )
        self.assertAlmostEqual(report["probabilities"][0], 0.5)
        self.assertAlmostEqual(report["probabilities"][7], 0.5)
        self.assertAlmostEqual(sum(report["probabilities"][1:7]), 0.0)

    def test_inverses_and_normalization(self) -> None:
        gates = [
            {"op": "H", "wire": 0},
            {"op": "H", "wire": 0},
            {"op": "X", "wire": 1},
            {"op": "X", "wire": 1},
            {"op": "S", "wire": 0},
            {"op": "S", "wire": 0},
            {"op": "S", "wire": 0},
            {"op": "S", "wire": 0},
            {"op": "RX", "wire": 1, "theta": 0.37},
            {"op": "RX", "wire": 1, "theta": -0.37},
            {"op": "RY", "wire": 0, "theta": 1.2},
            {"op": "RY", "wire": 0, "theta": -1.2},
        ]
        report = _run(2, gates)
        self.assertAlmostEqual(report["probabilities"][0], 1.0)
        self.assertAlmostEqual(sum(report["probabilities"]), 1.0)

    def test_wire_order(self) -> None:
        low = _run(2, [{"op": "X", "wire": 0}])
        high = _run(2, [{"op": "X", "wire": 1}])
        self.assertAlmostEqual(low["probabilities"][1], 1.0)
        self.assertAlmostEqual(high["probabilities"][2], 1.0)

    def test_swap_and_phase(self) -> None:
        swapped = _run(2, [{"op": "X", "wire": 1}, {"op": "SWAP", "wire_a": 0, "wire_b": 1}])
        self.assertAlmostEqual(swapped["probabilities"][1], 1.0)
        phased = _run(1, [{"op": "H", "wire": 0}, {"op": "Z", "wire": 0}], ["X"])
        self.assertAlmostEqual(phased["expectations"]["X"], -1.0, places=6)

    def test_rotation_matches_pauli_axis(self) -> None:
        report = _run(1, [{"op": "RY", "wire": 0, "theta": math.pi / 2}], ["Z", "X"])
        self.assertAlmostEqual(report["expectations"]["Z"], 0.0, places=6)
        self.assertAlmostEqual(report["expectations"]["X"], 1.0, places=6)

    def test_duplicate_key_and_mismatch(self) -> None:
        with self.assertRaises(OracleError):
            load_manifest('{"schema":1,"schema":1,"qubits":1,"gates":[]}')
        manifest = load_manifest('{"schema":1,"qubits":1,"gates":[{"op":"X","wire":0}],"observables":["Z"]}')
        verdict = verify(manifest, '{"probabilities":[1,0],"expectations":{"Z":1},"tolerance":1e-8}')
        self.assertEqual(verdict["state"], "MISMATCH")
        verdict = verify(manifest, '{"probabilities":[0,1],"expectations":{"Z":-1},"tolerance":1e-8}')
        self.assertEqual(verdict["state"], "MATCH")

    def test_t_eight_is_identity_on_probabilities(self) -> None:
        report = _run(1, [{"op": "T", "wire": 0}] * 8)
        self.assertAlmostEqual(report["probabilities"][0], 1.0)


if __name__ == "__main__":
    unittest.main()
