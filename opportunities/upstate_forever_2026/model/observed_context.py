"""Bind recovered observations and their figures into the current scientific report."""
from __future__ import annotations
import json
from pathlib import Path, PurePosixPath
import shutil
from .common import atomic_json, describe_file, file_digest, read_json

SCHEMA = "upstate.observed-report/v1"
ROLE = "OBSERVED_CONTEXT"
EDITION = "observed-context-20261013-v4"

def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Observed report members need canonical relative paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Observed report members must stay in their retained source")
    return path

def _source(workspace, selection):
    choice = selection.get("source_roles", {}).get(ROLE)
    if choice is None:
        return None
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    if entry["kind"] != "document":
        raise ValueError("Choose the retained observed scientific report document")
    recipe = read_json(path)
    if recipe.get("schema") != SCHEMA:
        raise ValueError("Observed scientific report source has another schema")
    body_view = _relative(entry["body"].get("view_path", entry["body"]["filename"]))
    root = Path(path)
    for unused in body_view.parts:
        root = root.parent
    members = {}
    for item in [entry["body"]] + entry.get("companions", []):
        relative = _relative(item.get("view_path", item["filename"])).as_posix()
        actual = root.joinpath(*PurePosixPath(relative).parts)
        if not actual.is_file() or actual.stat().st_size != item["bytes"] or file_digest(actual) != item["sha256"]:
            raise ValueError("Original observed scientific source changed: " + relative)
        if relative in members:
            raise ValueError("Observed source has duplicate member paths")
        members[relative] = {"path": actual, "bytes": item["bytes"], "sha256": item["sha256"]}
    for item in recipe.get("inputs", []):
        relative = _relative(item["path"]).as_posix()
        member = members.get(relative)
        if member is None or member["bytes"] != item["bytes"] or member["sha256"] != item["sha256"]:
            raise ValueError("Report input differs from its retained source: " + relative)
    sections = recipe.get("sections")
    if not isinstance(sections, list):
        raise ValueError("Observed source needs its scientific report sections")
    for section in sections:
        if not isinstance(section, list) or len(section) != 2 or not isinstance(section[1], list):
            raise ValueError("Observed report sections use heading and block lists")
        for block in section[1]:
            if isinstance(block, str):
                continue
            if not isinstance(block, dict) or block.get("kind") not in ("table", "links"):
                raise ValueError("Observed source has an unsupported report block")
            if block["kind"] == "table":
                cols = block.get("columns", [])
                if not cols or any(len(row) != len(cols) for row in block.get("rows", [])):
                    raise ValueError("Observed report table has inconsistent columns")
    binding = {"schema": "upstate.observed-report-binding/v1", "edition": EDITION,
               "source_collection_id": choice["source_collection_id"], "source_id": choice["source_id"],
               "body_sha256": entry["body"]["sha256"],
               "member_sha256": {name: members[name]["sha256"] for name in sorted(members)}}
    return {"binding": binding, "recipe": recipe, "entry": entry, "members": members}

def bind(workspace, selection):
    """Bind this selected original source before the native delivery identity."""
    source = _source(workspace, selection)
    return source["binding"] if source else None


def _bind_rows(source, rows, filename=None, *, member_prefix=""):
    """Attach the actual retained recipe selector and its verified member."""
    binding, members = source["binding"], source["members"]
    for row in rows:
        name = member_prefix + (filename or row["source_file"])
        member = members[name]
        row["source_selector"] = {
            "source_collection_id": binding["source_collection_id"],
            "source_id": binding["source_id"],
            "member_path": name, "member_sha256": member["sha256"],
        }
        row["source_member"] = {
            "path": name, "bytes": member["bytes"], "sha256": member["sha256"],
        }
        original_name = row.get("original_source_path")
        if original_name:
            original_name = member_prefix + original_name
            original = members.get(original_name)
            if original is None:
                raise ValueError("Original concentration response is absent: " + original_name)
            if row.get("original_source_sha256") != original["sha256"]:
                raise ValueError("Original concentration response identity differs: " + original_name)
            row["original_source_selector"] = {
                "source_collection_id": binding["source_collection_id"],
                "source_id": binding["source_id"],
                "member_path": original_name, "member_sha256": original["sha256"],
            }
    return rows


def _concentration_support(source):
    """Use the maintained original-study row and series producers."""
    from measurement_workspace import published_studies
    from measurement_workspace.observation_support import (
        CONCENTRATIONS, enrich_observation_context,
    )

    members = source["members"]
    measured = published_studies.WQP_FILE
    cohort = published_studies.WQP_COHORT
    # A direct study source retains plain member names. The regional report
    # retains the same study below its original application-relative namespace.
    # Resolve one complete namespace without changing source-authored row paths.
    prefixes = sorted({
        name[:-len(suffix)]
        for name in members for suffix in (measured, cohort)
        if name == suffix or name.endswith("/" + suffix)
    })
    if not prefixes:
        return None
    if len(prefixes) != 1:
        raise ValueError("Observed concentration context selects multiple original study namespaces")
    member_prefix = prefixes[0]
    required = (measured, cohort, "study.json", "stations.csv", "seasonal_summaries.csv")
    member_names = {name: member_prefix + name for name in required}
    missing = [name for name in member_names.values() if name not in members]
    if missing:
        raise ValueError("Observed concentration context is missing original inputs: " + ", ".join(missing))
    originals = {name: members[member_names[name]]["path"].read_bytes() for name in required}
    study = published_studies._json(originals["study.json"])
    if study.get("schema") != published_studies.STUDY_SCHEMA:
        raise ValueError("Observed concentration study has another original schema")
    stations = _bind_rows(
        source, published_studies._csv_rows(originals["stations.csv"], "stations"),
        "stations.csv", member_prefix=member_prefix,
    )
    seasonal = _bind_rows(
        source, published_studies._csv_rows(originals["seasonal_summaries.csv"], "seasonal"),
        "seasonal_summaries.csv", member_prefix=member_prefix,
    )
    rows = _bind_rows(
        source, published_studies._combined_observations(originals), member_prefix=member_prefix,
    )
    sites = {row["site_id"] for row in stations}
    observations = published_studies._observation_context(
        rows, seasonal, study, sites, set(CONCENTRATIONS), {"surface"},
    )
    return {
        "schema": "upstate.observed-concentration-context/v1",
        "source_binding": source["binding"],
        "study_id": study["study_id"],
        "selection": {
            "site_ids": sorted(sites), "parameters": sorted(CONCENTRATIONS),
            "strata": ["surface"], "sampling_period": study.get("grab_sampling", {}),
            "source_member_prefix": member_prefix,
        },
        "input_members": {
            name: {"bytes": members[name]["bytes"], "sha256": members[name]["sha256"]}
            for name in member_names.values()
        },
        "observations": enrich_observation_context(observations),
    }

def collect(workspace, selection, directory, state):
    """Return current report blocks and retained original assets for one delivery."""
    source = _source(workspace, selection)
    if source is None:
        return None
    binding = source["binding"]
    if selection.get("observed_context_binding") != binding:
        raise ValueError("Delivery observed source differs from the bound original edition")
    directory = Path(directory)
    members, recipe = source["members"], source["recipe"]
    prefix = Path("observed-context") / binding["body_sha256"]
    files, delivered = {}, {}
    for index, (name, item) in enumerate(sorted(members.items())):
        target = directory / prefix / _relative(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
                raise ValueError("Existing delivered observed source differs: " + name)
        else:
            shutil.copyfile(item["path"], target)
            if target.stat().st_size != item["bytes"] or file_digest(target) != item["sha256"]:
                raise ValueError("Delivered observed source differs: " + name)
        record = describe_file(directory, target, source_id=binding["source_id"], title=name)
        files["source_%03d" % index] = record
        delivered[name] = record
    sections = json.loads(json.dumps(recipe["sections"]))
    for unused, blocks in sections:
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "links":
                for item in block.get("items", []):
                    relative = _relative(item["path"]).as_posix()
                    if relative not in delivered:
                        raise ValueError("Report link names an unretained source member")
                    item["path"] = delivered[relative]["path"]
    concentration = _concentration_support(source)
    if concentration is not None:
        from measurement_workspace.observation_support import report_sections
        support_path = directory / "observed-support" / binding["body_sha256"] / "concentration-context.json"
        atomic_json(support_path, concentration)
        support_file = describe_file(
            directory, support_path, source_id=binding["source_id"],
            title="Original concentration rows, support and source selection",
        )
        files["concentration_support"] = support_file
        sections.extend(report_sections(concentration))
        sections.append(["Original concentration records and support", [
            {"kind": "links", "items": [{
                "title": "Complete concentration context and original result selectors",
                "path": support_file["path"],
            }]},
        ]])
    if recipe.get("figures"):
        spec_path = _relative(recipe["figure_spec"]).as_posix()
        if spec_path not in members:
            raise ValueError("Scientific figure specification was not retained")
        spec = read_json(members[spec_path]["path"])
        if spec.get("schema") != "upstate.scientific-figure-spec/v1":
            raise ValueError("Scientific figure specification schema differs")
        indexed = {}
        for figure in spec.get("figures", []):
            if figure["id"] in indexed:
                raise ValueError("Scientific figure identifiers must be unique")
            indexed[figure["id"]] = figure
        from .scientific_figures import _validate_figure
        blocks = []
        for choice in recipe["figures"]:
            figure = indexed[choice["id"]]
            _validate_figure(figure)
            relative = _relative(choice["path"]).as_posix()
            if relative not in delivered or not relative.lower().endswith(".svg"):
                raise ValueError("Scientific figure SVG was not retained")
            item = delivered[relative]
            blocks.append({"kind": "figure", "path": item["path"], "title": figure["title"],
                           "caption": figure.get("caption", ""), "alt": figure.get("caption", figure["title"]),
                           "bytes": item["bytes"], "sha256": item["sha256"], "spec": figure})
        sections.append(["Measured observations and flow context: scientific figures", blocks])
    sections.append(["Observed scientific source files", [{"kind": "links", "items": [
        {"title": item.get("title", name), "path": item["path"]}
        for name, item in sorted(delivered.items())
        if name in recipe.get("source_links", [])]}]])
    return {"sections": sections, "binding": binding, "files": files}
