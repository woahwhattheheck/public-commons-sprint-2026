"""Release explicitly closed receiving copies through the existing cache engine.

Version 5 plans keep recovery metadata on an explicitly selected filesystem.
The original consumer registry remains authoritative. No release is allowed
until that registry has retained the complete plan and custody pointers.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat


VERSION = 5


def cache():
    import swarm_cloud_cache
    return swarm_cloud_cache


def external_journal(directory, cache_root, *, validate_cache=True):
    c = cache()
    value = Path(directory)
    if (not value.is_absolute() or str(value) != str(value.resolve(strict=True))
            or value == Path(cache_root) or c.beneath(value, cache_root)):
        raise c.CacheError("Choose an existing real recovery directory outside the selected cache")
    info = value.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise c.CacheError("Recovery metadata needs an owner-private directory")
    if validate_cache and info.st_dev == Path(cache_root).stat().st_dev:
        raise c.CacheError("Closed-copy recovery metadata must use a different filesystem")
    return {"directory": str(value), "device": str(info.st_dev), "inode": str(info.st_ino)}


def validate_plan(plan):
    c = cache()
    ownership = plan.get("ownership")
    if (plan.get("version") != VERSION or plan.get("strategy") != "release"
            or not isinstance(ownership, dict) or ownership.get("closed") is not True
            or not isinstance(ownership.get("reference"), str) or not ownership["reference"].strip()
            or not isinstance(plan.get("runtime_consumers_root"), str)
            or not Path(plan["runtime_consumers_root"]).is_absolute()):
        raise c.CacheError("Retain the explicit closed-copy ownership and original registry")
    selected = plan.get("external_journal")
    if (not isinstance(selected, dict) or set(selected) != {"directory", "device", "inode"}
            or external_journal(selected["directory"], plan["cache_root"], validate_cache=False) != selected):
        raise c.CacheError("The original external recovery directory changed")
    for entry in plan["entries"]:
        if entry.get("match") != "complete":
            raise c.CacheError("Closed-copy release requires complete original file custody")
        if entry["custody"]["kind"] == "git-blob":
            raise c.CacheError("Use the existing pinned Git retirement path for Git custody")


def view(entry, observed, saved):
    """Absence identifies a state, never proof of an observed unlink."""
    if observed["state"] == "missing":
        if saved.get("phase") == "release_complete":
            return {**observed, "state": "released", "release_outcome": "recorded"}
        if saved.get("phase"):
            return {**observed, "state": "absent_outcome_unknown",
                    "release_outcome": "not_reconstructed_from_absence"}
        return {**observed, "state": "absent_before_release"}
    if saved.get("phase") == "release_complete":
        return {**observed, "state": "reappeared", "release_outcome": "new_path_preserved"}
    if observed["state"] == "original":
        original = entry["observed"]["identity"]
        actual = observed["identity"]
        if actual[:2] != original[:2] or actual[2:4] != original[2:4]:
            return {**observed, "state": "reappeared", "release_outcome": "new_inode_preserved"}
    return observed


def release_entry(plan_path, plan, state, entry):
    c = cache()
    saved = state["items"].get(entry["id"], {})
    current = view(entry, c.inspect_target(plan, entry), saved)
    zero = {"known_last_link_allocated_bytes_unlinked": 0, "known_original_names_unlinked": 0,
            "known_marker_allocated_bytes_created": 0, "known_marker_inodes_created": 0}
    if current["state"] != "original":
        return {"path": entry["path"], **current, "physical_accounting_this_call": zero}
    old = saved.get("physical_accounting") or {}
    if any(type(old.get(key, 0)) is not int or old.get(key, 0) < 0 for key in zero):
        raise c.CacheError("Preserve the original closed-copy accounting")
    observed = None
    with c.parent_fd(plan["cache_root"], entry["path"]) as (directory, name):
        target = Path(plan["cache_root"]) / entry["path"]
        # The existing Linux lease prevents a concurrent opener/writer. The
        # registry lock is already held by the caller for this exact path.
        with c.selected_file(name, dir_fd=directory, display_path=target,
                             require_unused=True) as held:
            actual = c.inspect_fd(held.fd)
            before = os.fstat(held.fd)
            frozen = entry["observed"]["identity"]
            if (not c.same_bytes(actual, entry["original"])
                    or actual["identity"][:2] != frozen[:2]
                    or actual["identity"][2:4] != frozen[2:4]
                    or c.identity(before) != tuple(actual["identity"])
                    or c.identity(os.stat(name, dir_fd=directory, follow_symlinks=False))
                    != c.identity(before)):
                raise c.CacheError("The closed original inode changed; preserve its current path")
            prior_attempt = saved.get("release_attempt", 0)
            if type(prior_attempt) is not int or prior_attempt < 0:
                raise c.CacheError("Invalid retained release attempt")
            attempt = prior_attempt + 1
            accounting = {"version": 1, "earlier_history_unknown": bool(
                old.get("earlier_history_unknown") or saved.get("phase")),
                **{key: old.get(key, 0) for key in zero}}
            c.record(plan_path, state, entry, state="releasing", phase="release_prepared",
                     release_attempt=attempt, release_identity=list(c.identity(before)),
                     release_links=before.st_nlink, release_allocated_bytes=before.st_blocks * 512,
                     file_use=held.observation(), physical_accounting=accounting)
            # No rename, new marker, staging payload or target-volume checkpoint.
            held.change("unlink_closed_copy", lambda: os.unlink(name, dir_fd=directory))
            after = os.fstat(held.fd)
            os.fsync(directory)
            observed = {"last_link_allocated_bytes_unlinked":
                            before.st_blocks * 512 if after.st_nlink == 0 else 0,
                        "original_names_unlinked": 1,
                        "device": str(before.st_dev), "inode": str(before.st_ino),
                        "links_before": before.st_nlink, "links_after": after.st_nlink,
                        "directory_synced": True}
        # Count after the held original descriptor has closed successfully.
        observed["descriptor_closed"] = True
        observed["file_use"] = held.observation()
    measured = {**zero,
                "known_last_link_allocated_bytes_unlinked": observed["last_link_allocated_bytes_unlinked"],
                "known_original_names_unlinked": 1}
    accounting = {"version": 1,
                  "earlier_history_unknown": bool(old.get("earlier_history_unknown") or saved.get("phase")),
                  **{key: old.get(key, 0) + measured[key] for key in zero}}
    c.record(plan_path, state, entry, state="released", phase="release_complete",
             released_once=True, release_observation=observed,
             physical_accounting=accounting, error=None)
    return {"path": entry["path"], "state": "released", "action": "closed_copy_unlinked",
            "release_observation": observed, "physical_accounting_this_call": measured}



def prepare(plan_path, *, expected_plan, runtime_consumers_root=None):
    """Finish only the same reviewed plan's original registry registration."""
    c = cache()
    plan = c.load_plan(plan_path)
    validate_plan(plan)
    if plan["plan_id"] != expected_plan:
        raise c.CacheError("Select the exact reviewed closed-copy plan")
    consumers = c.retirement_guard(plan, runtime_consumers_root)
    with c.Custody() as verifier:
        targets = [Path(plan["cache_root"]) / row["path"] for row in plan["entries"]]
        inodes = set()
        for target in targets:
            try:
                inodes.add(c.identity(target.lstat())[:2])
            except FileNotFoundError:
                pass
        verifier.protect_selected(targets, inodes)
        for entry in plan["entries"]:
            verifier.check(entry)
        with consumers.plan_journal(plan_path, plan, custody_paths=[
                *c.git_backing_paths(plan), *verifier.files]) as retained:
            c.load_state(retained, plan)
        return {"ok": True, "state": "prepared", "plan_id": plan["plan_id"],
                "retained_plan": str(retained), "external_journal": plan["external_journal"],
                "runtime_consumers_root": str(consumers.root),
                "released_bytes": 0}


def release(plan_path, *, expected_plan, runtime_consumers_root=None):
    c = cache()
    from native_library_backing import hold_plan_custody
    with hold_plan_custody(plan_path, runtime_consumers_root=runtime_consumers_root) as bound, \
            c.Custody(custody_files=bound["custody_files"]) as verifier:
        selected, plan, consumers = c.resolved_plan(plan_path, runtime_consumers_root)
        validate_plan(plan)
        if expected_plan != plan["plan_id"]:
            raise c.CacheError("Select the exact reviewed closed-copy plan")
        # Prepared registration is a prerequisite. Do not invent a new registry
        # or unlink first to make room for its authoritative recovery pointer.
        pointer = consumers.root / "cache-plans" / (plan["plan_id"] + ".json")
        from runtime_consumers import _registered_plan
        registered_pointer = c.read_json(pointer)
        if registered_pointer.get("external_journal") != plan["external_journal"]:
            raise c.CacheError("The original registry has not registered this external recovery journal")
        retained, registered = _registered_plan(consumers.root, registered_pointer)
        if retained != selected or registered != plan:
            raise c.CacheError("Prepare the original registry's complete external journal before release")
        targets = [Path(plan["cache_root"]) / entry["path"] for entry in plan["entries"]]
        inodes = set()
        for target in targets:
            try:
                inodes.add(c.identity(target.lstat())[:2])
            except FileNotFoundError:
                pass
        verifier.protect_selected(targets, inodes)
        before = c.disk_space(plan["cache_root"])
        results = []
        with consumers.plan_journal(selected, plan, custody_paths=c.git_backing_paths(plan)) as retained, \
                c.CoalesceProgress(retained, plan) as state:
            counts_before = c.recorded_retirement_allocation(state)
            for entry in plan["entries"]:
                try:
                    verifier.check(entry)
                    with consumers.hold(Path(plan["cache_root"]) / entry["path"]) as usage:
                        if usage["consumers"]:
                            result = {"path": entry["path"], "state": "in_use",
                                      "consumers": usage["consumers"]}
                        else:
                            result = release_entry(retained, plan, state, entry)
                except (OSError, ValueError, c.CacheError, c.zipfile.BadZipFile) as error:
                    result = {"path": entry["path"], "state": "preserved", "error": str(error)}
                    if getattr(error, "file_use", None):
                        result["file_use"] = error.file_use
                    try:
                        # Keep the prepared phase: a missing path after this
                        # error must stay explicitly uncertain on reopen.
                        c.record(retained, state, entry, error=str(error))
                    except OSError as journal_error:
                        result["journal_error"] = str(journal_error)
                results.append(result)
        counts_after = c.recorded_retirement_allocation(state)
        return {"ok": all(row["state"] == "released" for row in results),
                "strategy": "release", "plan_id": plan["plan_id"], "retained_plan": str(retained),
                "external_journal": plan["external_journal"], "entries": results,
                "disk_before": before, "disk_after": c.disk_space(plan["cache_root"]),
                "journal": state.metrics,
                "physical_accounting": {
                    "recorded_this_call": {key: counts_after[key] - counts_before[key]
                                          for key in counts_after if key.startswith("known_")},
                    "recorded_history": counts_after,
                    "meaning": "Observed closed-descriptor last-link allocation; global free space may change independently.",
                    "interruption": "Absent paths never reconstruct an unrecorded unlink or released-byte count."},
                **({"library_custody": bound["library_custody"]} if bound["library_custody"] else {})}
