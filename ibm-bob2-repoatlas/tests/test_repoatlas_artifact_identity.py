from __future__ import annotations

import copy
import gc
import json
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

import repoatlas.core as core
from repoatlas.core import MAX_JSON_DEPTH, RepoAtlasError, compile_packet, verify_bundle

ROOT = Path(__file__).parents[1]


def fixture():
    return json.loads((ROOT / "fixtures" / "synthetic-repo.json").read_text())


def canonical_size(value):
    return len(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8", "strict")
    )


def canonical_bytes(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8", "strict")


def deeply_nested_array():
    value = False
    for _ in range(MAX_JSON_DEPTH + 1):
        value = [value]
    return value


class RepoAtlasArtifactIdentityTests(unittest.TestCase):
    def test_packet_bool_int_alias_is_not_the_same_artifact(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        aliased_packet = copy.deepcopy(packet)
        self.assertIs(aliased_packet["authority"]["auto_merge"], False)
        aliased_packet["authority"]["auto_merge"] = 0
        self.assertEqual(aliased_packet, packet)  # proves the Python-equality predecessor
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
            verify_bundle(raw, aliased_packet, receipt)

    def test_receipt_bool_int_alias_is_not_the_same_artifact(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        aliased_receipt = copy.deepcopy(receipt)
        self.assertIs(aliased_receipt["authority_external_action"], False)
        aliased_receipt["authority_external_action"] = 0
        self.assertEqual(aliased_receipt, receipt)  # proves the Python-equality predecessor
        with self.assertRaisesRegex(RepoAtlasError, "verify:receipt_mismatch"):
            verify_bundle(raw, packet, aliased_receipt)

    def test_deep_packet_is_stable_fail_closed_not_raw_recursion(self):
        raw = fixture()
        _, receipt = compile_packet(raw)
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_deep"):
            verify_bundle(raw, deeply_nested_array(), receipt)

    def test_deep_receipt_is_stable_fail_closed_not_raw_recursion(self):
        raw = fixture()
        packet, _ = compile_packet(raw)
        with self.assertRaisesRegex(RepoAtlasError, "verify:receipt_too_deep"):
            verify_bundle(raw, packet, deeply_nested_array())

    def test_over_budget_scalar_fails_before_candidate_serialization(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        expected_bytes = canonical_size(packet)
        oversized_packet = {"x": "A" * (expected_bytes + 1)}
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_complex"):
            verify_bundle(raw, oversized_packet, receipt)

    def test_shared_scalar_alias_amplification_is_charged_per_occurrence(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        expected_bytes = canonical_size(packet)
        shared = "A" * 1024
        repeats = max(2, expected_bytes // len(shared) + 2)
        amplified_packet = {"x": [shared] * repeats}
        self.assertIs(amplified_packet["x"][0], amplified_packet["x"][1])
        self.assertGreater(canonical_size(amplified_packet), expected_bytes)
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_too_complex"):
            verify_bundle(raw, amplified_packet, receipt)

    def test_source_snapshot_precedes_cardinality_and_policy_reads(self):
        raw = fixture()
        original_packet, _ = compile_packet(copy.deepcopy(raw))
        switched = False

        def mutate_after_snapshot(frame, event, _arg):
            nonlocal switched
            if (
                event == "line"
                and frame.f_code is core._validate_source_input.__code__
                and frame.f_locals.get("raw") is raw
                and "source_snapshot" in frame.f_locals
                and not switched
            ):
                # This would bypass the predecessor's preflight->validate
                # ceiling if later validation reread caller raw.
                raw["changes"] = [None] * (core.MAX_CHANGES + 1)
                switched = True
            return mutate_after_snapshot

        prior_trace = sys.gettrace()
        sys.settrace(mutate_after_snapshot)
        try:
            packet, _ = compile_packet(raw)
        finally:
            sys.settrace(prior_trace)

        self.assertTrue(switched)
        self.assertEqual(len(raw["changes"]), core.MAX_CHANGES + 1)
        self.assertEqual(packet, original_packet)

    def test_source_snapshot_blocks_cross_sibling_trace_splice(self):
        raw = fixture()
        provider = raw["provider"]
        self.assertFalse(any(provider.values()))
        switched = False

        def splice_inside_snapshot(frame, event, _arg):
            nonlocal switched
            if (
                event == "line"
                and frame.f_code is core._canonical_verified_artifact.__code__
                and frame.f_locals.get("name") == "source"
                and frame.f_locals.get("current") is provider
                and not switched
            ):
                provider.update({key: True for key in provider})
                switched = True
            return splice_inside_snapshot

        prior_trace = sys.gettrace()
        sys.settrace(splice_inside_snapshot)
        try:
            packet, _ = compile_packet(raw)
        finally:
            sys.settrace(prior_trace)

        self.assertFalse(switched)
        self.assertFalse(any(provider.values()))
        self.assertEqual(packet["competition_state"], "PROVIDER_GATE_HOLD")

    def test_bounded_larger_packet_is_mismatch_not_complexity(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        candidate = copy.deepcopy(packet)
        candidate["bounded_extra"] = "x"
        self.assertGreater(canonical_size(candidate), canonical_size(packet))
        with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
            verify_bundle(raw, candidate, receipt)

    def test_source_validation_generation_is_detached_before_compile(self):
        raw = fixture()
        provider = raw["provider"]
        self.assertFalse(any(provider.values()))
        switched = False

        def flip_after_source_admission(frame, event, _arg):
            nonlocal switched
            if (
                event == "line"
                and frame.f_code is core.compile_packet.__code__
                and frame.f_locals.get("raw") is raw
                and "normalized" in frame.f_locals
                and not switched
            ):
                provider.update({key: True for key in provider})
                switched = True
            return flip_after_source_admission

        prior_trace = sys.gettrace()
        sys.settrace(flip_after_source_admission)
        try:
            packet, _receipt = compile_packet(raw)
        finally:
            sys.settrace(prior_trace)

        self.assertTrue(switched)
        self.assertTrue(all(provider.values()))  # proves caller generation moved
        self.assertEqual(packet["competition_state"], "PROVIDER_GATE_HOLD")
        codes = {finding["code"] for finding in packet["findings"]}
        self.assertTrue(
            {
                "BOB_EXECUTION_REQUIRED",
                "TRACKS_UNPUBLISHED",
                "REGISTRATION_NOT_VERIFIED",
                "SUBMISSION_NOT_VERIFIED",
            }.issubset(codes)
        )

    def test_verify_bundle_reuses_detached_source_generation(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        provider = raw["provider"]
        switched = False

        def flip_after_source_admission(frame, event, _arg):
            nonlocal switched
            if (
                event == "line"
                and frame.f_code is core.compile_packet.__code__
                and frame.f_locals.get("raw") is raw
                and "normalized" in frame.f_locals
                and not switched
            ):
                provider.update({key: True for key in provider})
                switched = True
            return flip_after_source_admission

        prior_trace = sys.gettrace()
        sys.settrace(flip_after_source_admission)
        try:
            self.assertTrue(verify_bundle(raw, packet, receipt))
        finally:
            sys.settrace(prior_trace)

        self.assertTrue(switched)
        self.assertTrue(all(provider.values()))
    def test_cross_sibling_callback_cannot_splice_valid_packet_generation(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        candidate = copy.deepcopy(packet)
        summary = candidate["summary"]
        authority = candidate["authority"]
        self.assertIs(authority["auto_merge"], False)

        # State A: summary is correct, authority is canonically wrong. The
        # hostile callback is armed to switch to state B only after the summary
        # subtree has been copied but before the authority subtree is copied.
        # State B makes summary wrong and authority correct. Neither state is
        # the expected packet, but the predecessor could splice the correct
        # half from each state into one verifier-owned artifact.
        authority["auto_merge"] = 0
        summary_key = next(
            key
            for key, value in summary.items()
            if type(value) in (bool, int, float, str)
        )
        original_summary_value = summary[summary_key]
        if type(original_summary_value) is bool:
            wrong_summary_value = not original_summary_value
        elif type(original_summary_value) is int:
            wrong_summary_value = original_summary_value + 1
        elif type(original_summary_value) is float:
            wrong_summary_value = original_summary_value + 1.0
        else:
            wrong_summary_value = original_summary_value + "#mutated"

        switched = False

        def splice_on_authority(frame, event, _arg):
            nonlocal switched
            if (
                event == "line"
                and frame.f_code is core._canonical_verified_artifact.__code__
                and frame.f_locals.get("current") is authority
                and not switched
            ):
                # Transition A -> both wrong -> B. There is deliberately never
                # an instant where the live caller packet equals the expected
                # packet.
                summary[summary_key] = wrong_summary_value
                authority["auto_merge"] = False
                switched = True
            return splice_on_authority

        prior_trace = sys.gettrace()
        sys.settrace(splice_on_authority)
        try:
            with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
                verify_bundle(raw, candidate, receipt)
        finally:
            sys.settrace(prior_trace)

        # The verifier's cooperative snapshot fence suspends current-thread
        # trace callbacks during the caller-owned graph copy, so the armed
        # cross-sibling splice cannot run inside that critical section.
        self.assertFalse(switched)
        self.assertEqual(summary[summary_key], original_summary_value)
        self.assertEqual(authority["auto_merge"], 0)

    def test_automatic_gc_callback_cannot_cross_sibling_freeze_generation(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        candidate = copy.deepcopy(packet)
        summary = candidate["summary"]
        authority = candidate["authority"]
        self.assertIs(authority["auto_merge"], False)

        # State A is invalid only in authority. An automatic cyclic-GC callback
        # is armed to detect the old verifier while it is actively freezing the
        # later authority subtree, then flip to state B where summary is wrong
        # and authority is correct. Neither caller generation is valid; the
        # predecessor could nevertheless retain old-correct summary plus
        # later-correct authority if a GC callback ran between the sibling
        # copies.
        authority["auto_merge"] = 0
        summary_key = next(
            key
            for key, value in summary.items()
            if type(value) in (bool, int, float, str)
        )
        original_summary_value = summary[summary_key]
        if type(original_summary_value) is bool:
            wrong_summary_value = not original_summary_value
        elif type(original_summary_value) is int:
            wrong_summary_value = original_summary_value + 1
        elif type(original_summary_value) is float:
            wrong_summary_value = original_summary_value + 1.0
        else:
            wrong_summary_value = original_summary_value + "#gc-mutated"

        switched = False

        def splice_on_gc(phase, _info):
            nonlocal switched
            if phase != "start" or switched:
                return
            frame = sys._getframe()
            while frame is not None:
                if (
                    frame.f_code is core._canonical_verified_artifact.__code__
                    and frame.f_locals.get("current") is authority
                ):
                    summary[summary_key] = wrong_summary_value
                    authority["auto_merge"] = False
                    switched = True
                    return
                frame = frame.f_back

        old_threshold = gc.get_threshold()
        gc.callbacks.append(splice_on_gc)
        gc.set_threshold(1, 1, 1)
        try:
            with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
                verify_bundle(raw, candidate, receipt)
        finally:
            gc.set_threshold(*old_threshold)
            gc.callbacks.remove(splice_on_gc)

        self.assertFalse(switched)
        self.assertEqual(summary[summary_key], original_summary_value)
        self.assertEqual(authority["auto_merge"], 0)

    def test_serializer_rebinding_does_not_change_verifier_identity(self):
        raw = fixture()
        packet, receipt = compile_packet(raw)
        changed_packet = copy.deepcopy(packet)
        changed_packet["authority"]["auto_merge"] = 0
        changed_receipt = copy.deepcopy(receipt)
        changed_receipt["authority_external_action"] = 0
        canonical = core._source._canonical

        def alternate(value):
            if type(value) is dict and (
                "packet_sha256" in value or "receipt_sha256" in value
            ):
                return b"alternate"
            return canonical(value)

        with mock.patch.object(core._source, "_canonical", side_effect=alternate):
            with self.assertRaisesRegex(RepoAtlasError, "verify:packet_mismatch"):
                verify_bundle(raw, changed_packet, receipt)
            with self.assertRaisesRegex(RepoAtlasError, "verify:receipt_mismatch"):
                verify_bundle(raw, packet, changed_receipt)

    def test_mutation_after_bounded_freeze_cannot_change_serialized_generation(self):
        raw = fixture()
        packet, _ = compile_packet(raw)
        candidate = copy.deepcopy(packet)
        expected = canonical_bytes(packet)
        serializer_entered = threading.Event()
        mutation_done = threading.Event()
        original_canonical = core._source._canonical

        def mutate_caller_generation():
            if not serializer_entered.wait(5):
                return
            # This exceeds the trusted packet byte budget. The predecessor
            # serialized this caller-owned generation after preflighting the
            # earlier small generation, reopening the work-budget boundary.
            candidate["authority"] = "A" * (len(expected) + 1)
            mutation_done.set()

        def serialize_after_mutation(frozen):
            serializer_entered.set()
            if not mutation_done.wait(5):
                raise RuntimeError("mutation hostile did not synchronize")
            return original_canonical(frozen)

        worker = threading.Thread(target=mutate_caller_generation)
        worker.start()
        try:
            actual = core._canonical_verified_artifact(
                candidate,
                "packet",
                len(expected),
                _canonical=serialize_after_mutation,
            )
        finally:
            worker.join(5)

        self.assertFalse(worker.is_alive())
        self.assertTrue(mutation_done.is_set())
        self.assertGreater(canonical_size(candidate), len(expected))
        self.assertEqual(expected, actual)


if __name__ == "__main__":
    unittest.main()