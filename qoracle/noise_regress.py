"""Four focused analytical/CLI contracts for the noisy-circuit extension."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import json
import math
from pathlib import Path
import tempfile
import unittest

from .engine import OracleError, load_manifest, simulate
from .noise import load_noise_manifest, main, simulate_noise, verify_noise


def manifest(gates=None, *, n=1, observables=None, noise=None, **extra):
    return {"schema": 1, "circuit": {"schema": 1, "qubits": n,
            "gates": gates or [], "observables": observables or []},
            "noise": noise or [], **extra}


def event(channel, p, after=1, wire=0):
    return {"after_gate": after, "channel": channel, "wire": wire, "p": p}


def run(value):
    return simulate_noise(json.dumps(value))


class NoiseContracts(unittest.TestCase):
    def test_channels_match_analytic_populations_and_coherence(self):
        damped = run(manifest([{"op": "X", "wire": 0}], observables=["Z"],
                             noise=[event("AMPLITUDE_DAMPING", 0.25)]))
        self.assertEqual(damped["probabilities"], [0.25, 0.75])
        self.assertAlmostEqual(damped["expectations"]["Z"], -0.5)
        self.assertAlmostEqual(damped["diagnostics"]["purity"], 0.625)
        imaginary = [{"op": "H", "wire": 0}, {"op": "S", "wire": 0}]
        phase = run(manifest(imaginary, observables=["Y"],
                             noise=[event("PHASE_DAMPING", 0.75, after=2)]))
        self.assertAlmostEqual(phase["expectations"]["Y"], 0.5)
        self.assertAlmostEqual(phase["diagnostics"]["purity"], 0.625)
        mixed = run(manifest(imaginary, observables=["X", "Y", "Z"],
                             noise=[event("DEPOLARIZING", 0.75, after=2)]))
        self.assertAlmostEqual(mixed["diagnostics"]["purity"], 0.5)
        self.assertTrue(all(abs(value) < 1e-12 for value in mixed["expectations"].values()))
        pauli_error = run(manifest(imaginary, observables=["Y"],
                                   noise=[event("DEPOLARIZING", 1.0, after=2)]))
        self.assertAlmostEqual(pauli_error["expectations"]["Y"], -1 / 3)

    def test_entanglement_gate_boundaries_and_statevector_parity(self):
        source = json.loads((Path(__file__).parent / "examples/bell.amplitude-noise.json").read_text())
        bell = run(source)
        for actual, expected in zip(bell["probabilities"], [0.5, 0.2, 0.0, 0.3]):
            self.assertAlmostEqual(actual, expected)
        for label, value in {"XX": math.sqrt(0.6), "YY": -math.sqrt(0.6),
                             "ZZ": 0.6, "ZI": 0.4, "IZ": 0.0}.items():
            self.assertAlmostEqual(bell["expectations"][label], value)
        self.assertAlmostEqual(bell["diagnostics"]["purity"], 0.68)
        # Same-boundary channel order changes the physical state and is retained.
        reset = event("AMPLITUDE_DAMPING", 1, after=0)
        mix = event("DEPOLARIZING", 0.75, after=0)
        self.assertEqual(run(manifest(noise=[reset, mix]))["probabilities"], [0.5, 0.5])
        self.assertEqual(run(manifest(noise=[mix, reset]))["probabilities"], [1.0, 0.0])
        flips = [{"op": "X", "wire": 0}] * 2
        self.assertEqual(run(manifest(flips, noise=[event("AMPLITUDE_DAMPING", 1)]))["probabilities"], [0.0, 1.0])
        self.assertEqual(run(manifest(flips, noise=[event("AMPLITUDE_DAMPING", 1, after=2)]))["probabilities"], [1.0, 0.0])
        gates = [{"op": op, "wire": 0} for op in ("H", "X", "Y", "Z", "S", "T")]
        gates += [{"op": op, "wire": 1, "theta": theta}
                  for op, theta in (("RX", 0.3), ("RY", -0.7), ("RZ", 1.2))]
        gates += [{"op": "CNOT", "control": 1, "target": 0},
                  {"op": "CZ", "control": 0, "target": 1},
                  {"op": "SWAP", "wire_a": 0, "wire_b": 1}]
        value = manifest(gates, n=2, observables=["XI", "IY", "ZZ", "YX"])
        value["circuit"]["probability_wires"] = [1]
        pure = simulate(load_manifest(json.dumps(value["circuit"])))
        density = run(value)
        for a, b in zip(pure["probabilities"], density["probabilities"]):
            self.assertAlmostEqual(a, b)
        for label, expected in pure["expectations"].items():
            self.assertAlmostEqual(density["expectations"][label], expected)
        self.assertAlmostEqual(density["diagnostics"]["purity"], 1.0)

    def test_sampling_and_manifest_bound_verifier_cli(self):
        source = json.loads((Path(__file__).parent / "examples/bell.amplitude-noise.json").read_text())
        result = run(source)
        self.assertEqual(result["sampling"], run(source)["sampling"])
        self.assertEqual(sum(result["sampling"]["counts"]), 1000)
        self.assertEqual(result["sampling"]["counts"][2], 0)
        other_seed = copy.deepcopy(source)
        other_seed["sampling"]["seed"] += 1
        self.assertNotEqual(result["manifest_sha256"], run(other_seed)["manifest_sha256"])
        candidate = {key: result[key] for key in ("schema", "manifest_sha256", "probabilities", "expectations")}
        text = json.dumps(source)
        self.assertEqual(verify_noise(text, json.dumps(candidate))["state"], "MATCH")
        wrong_binding = {**candidate, "manifest_sha256": "0" * 64}
        self.assertEqual(verify_noise(text, json.dumps(wrong_binding))["state"], "MISMATCH")
        wrong_value = copy.deepcopy(candidate)
        wrong_value["probabilities"][0] -= 0.1
        wrong_value["probabilities"][1] += 0.1
        self.assertEqual(verify_noise(text, json.dumps(wrong_value))["state"], "MISMATCH")
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            candidate_path = Path(directory) / "candidate.json"
            manifest_path.write_text(text)
            candidate_path.write_text(json.dumps(wrong_value))
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                status = main(["verify", str(manifest_path), str(candidate_path)])
            self.assertEqual(status, 1)
            self.assertEqual(json.loads(out.getvalue())["state"], "MISMATCH")
            self.assertEqual(err.getvalue(), "")

    def test_invalid_inputs_are_rejected_without_running_simulation(self):
        invalid = [manifest(n=7), manifest(noise=[event("DEPOLARIZING", 1.1, after=0)]),
                   manifest(noise=[event("PHASE_DAMPING", 0.3, after=1)]),
                   manifest(sampling={"shots": 10, "seed": True}),
                   {**manifest(), "schema": True}, {**manifest(), "unexpected": 1}]
        for item in invalid:
            with self.assertRaises(OracleError):
                load_noise_manifest(json.dumps(item))
        for text in ('{"schema":1,"schema":1}', '{"x":NaN}', '{"x":' + '9' * 5000 + '}'):
            with self.assertRaises(OracleError):
                load_noise_manifest(text)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_bytes(b"\xff")
            with redirect_stderr(io.StringIO()), redirect_stdout(io.StringIO()):
                self.assertEqual(main(["simulate", str(path)]), 2)


if __name__ == "__main__":
    unittest.main()
