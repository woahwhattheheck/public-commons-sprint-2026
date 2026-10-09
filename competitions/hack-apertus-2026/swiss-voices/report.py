#!/usr/bin/env python3
"""Offline redacted Swiss Voices workspace auditor; not an official score."""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import unicodedata

LOCALES = {"de-CH", "fr-CH", "it-CH", "rm-CH"}
KINDS = {"synthetic", "public_domain", "consented_person"}
RUBRIC = {"linguistic_fidelity", "swiss_context_accuracy", "respectful_localization"}


def fp(value):
    return hashlib.sha256(json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def identity(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("missing reviewer alias")
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def check(ok, message):
    if not ok:
        raise ValueError(message)


def inspect_workspace(data, minimum=5):
    """Recompute v1 receipt chains; never include text/aliases in the result."""
    check(type(minimum) is int and 5 <= minimum <= 1000,
          "minimum group must be at least five")
    check(isinstance(data, dict) and data.get("format") == 1
          and isinstance(data.get("cases"), list)
          and len(data["cases"]) <= 1000, "invalid workspace")
    total, kinds = Counter(), Counter()
    locales = {loc: Counter() for loc in sorted(LOCALES)}
    seen_ids = set()
    for i, case in enumerate(data["cases"]):
        check(isinstance(case, dict), f"case {i}: invalid")
        case_id, locale, kind = case.get("id"), case.get("locale"), case.get("source_kind")
        check(isinstance(case_id, str) and locale in LOCALES and kind in KINDS,
              f"case {i}: invalid metadata")
        check(case_id not in seen_ids, f"case {i}: duplicate")
        seen_ids.add(case_id)
        keys = ("locale", "prompt", "context", "source_kind",
                "attribution", "human_attested")
        check(all(k in case for k in keys)
              and all(isinstance(case[k], str) and case[k].strip()
                      for k in ("prompt", "context", "attribution")),
              f"case {i}: missing source")
        check(type(case["human_attested"]) is bool
              and case["human_attested"] == (kind == "consented_person"),
              f"case {i}: invalid attestation")
        original = {k: case[k] for k in keys}
        original.update(reference="", approved=False)
        check(case_id == fp(original)[:18], f"case {i}: source hash mismatch")
        check(type(case.get("approved")) is bool
              and isinstance(case.get("runs"), list) and len(case["runs"]) <= 100,
              f"case {i}: invalid approval/runs")
        total["cases"] += 1
        kinds[kind] += 1
        locales[locale]["cases"] += 1
        if not case["approved"]:
            check(case.get("reference") == "" and not case["runs"],
                  f"case {i}: unapproved evidence")
            continue
        approver = case.get("approved_by")
        approver_id = identity(approver)
        check(isinstance(case.get("reference"), str) and bool(case["reference"].strip()),
              f"case {i}: missing reference")
        source_hash = fp({"id": case_id, "reference": case["reference"], "reviewer": approver})
        check(case.get("approval_sha256") == source_hash,
              f"case {i}: approval hash mismatch")
        total["approved_cases"] += 1
        locales[locale]["approved_cases"] += 1
        models = set()
        for j, run in enumerate(case["runs"]):
            check(isinstance(run, dict) and isinstance(run.get("model"), str)
                  and bool(run["model"]) and run["model"] not in models,
                  f"case {i} run {j}: invalid or duplicate model")
            models.add(run["model"])
            answer = run.get("answer")
            check(isinstance(answer, str) and bool(answer.strip()),
                  f"case {i} run {j}: empty model answer")
            answer_hash = fp(answer)
            check(run.get("source_sha256") == source_hash
                  and run.get("answer_sha256") == answer_hash
                  and run.get("id") == fp({
                      "case": case_id, "answer": answer, "model": run["model"]
                  })[:18], f"case {i} run {j}: hash mismatch")
            reviews = run.get("reviews")
            check(isinstance(reviews, list) and len(reviews) <= 100,
                  f"case {i} run {j}: invalid reviews")
            total["recorded_runs"] += 1
            locales[locale]["recorded_runs"] += 1
            reviewer_ids = set()
            for k, review in enumerate(reviews):
                check(isinstance(review, dict),
                      f"case {i} run {j} review {k}: invalid")
                rid = identity(review.get("reviewer"))
                check(rid != approver_id and rid not in reviewer_ids,
                      f"case {i} run {j}: duplicate/nonindependent reviewer")
                reviewer_ids.add(rid)
                scores = review.get("scores")
                check(isinstance(scores, dict) and set(scores) == RUBRIC
                      and all(type(scores[x]) is int and 1 <= scores[x] <= 5
                              for x in RUBRIC)
                      and isinstance(review.get("notes"), str)
                      and bool(review["notes"].strip()),
                      f"case {i} run {j} review {k}: invalid rubric")
                signature = {
                    "reviewer": review["reviewer"], "notes": review["notes"],
                    "scores": scores, "answer_sha256": answer_hash
                }
                check(review.get("sha256") == fp(signature)
                      and review.get("answer_sha256") == answer_hash,
                      f"case {i} run {j} review {k}: review hash mismatch")
                total["reviewer_scores"] += 1
                locales[locale]["reviewer_scores"] += 1
            if reviews:
                total["reviewed_runs"] += 1
                locales[locale]["reviewed_runs"] += 1
                if kind != "synthetic":
                    total["nonsynthetic_reviewed_runs"] += 1
    fields = ("cases", "approved_cases", "recorded_runs",
              "reviewed_runs", "reviewer_scores", "nonsynthetic_reviewed_runs")
    visible = {}
    for locale, counts in locales.items():
        visible[locale] = ({"suppressed": True} if counts["cases"] < minimum else
                           {"suppressed": False, **{
                               k: counts[k] for k in fields[:-1]
                           }})
    return {
        "schema": "swiss-voices-safe-report-v1",
        "official_submission_status": "NOT_VERIFIED",
        "data_status": ("NON_SYNTHETIC_REVIEWED_RECORDS_UNVERIFIED"
                        if total["nonsynthetic_reviewed_runs"]
                        else "SYNTHETIC_ONLY_OR_UNREVIEWED"),
        "totals": {k: total[k] for k in fields},
        "source_kind_counts": {k: kinds[k] for k in sorted(KINDS)},
        "locale_counts": visible,
        "locale_minimum": minimum,
        "limitations": [
            "Source hashes prove local record integrity, not actual model execution.",
            "Human identity, fluency, source rights and consent are self-attested.",
            "All scores are reviewer supplied, not organizer/hidden evaluation.",
            "No prompts, model responses, notes, names or case IDs are exported.",
            "Small group suppression reduces, but cannot eliminate, inference risk.",
            "Original entrant must verify current official Track 1B rules and submit."
        ],
    }


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("workspace", type=Path)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--min-locale-group", type=int, default=5)
    args = p.parse_args(argv)
    check(args.workspace.resolve() != args.out.resolve(), "cannot overwrite input")
    check(args.workspace.is_file() and args.workspace.stat().st_size <= 8_000_000,
          "workspace unavailable or oversized")
    state = json.loads(args.workspace.read_text("utf-8"))
    result = inspect_workspace(state, args.min_locale_group)
    with args.out.open("x", encoding="utf-8") as f:
        json.dump(result, f, sort_keys=True, indent=2)
        f.write("\n")
    print("Redacted local report created; official submission NOT_VERIFIED")


if __name__ == "__main__":
    main()
