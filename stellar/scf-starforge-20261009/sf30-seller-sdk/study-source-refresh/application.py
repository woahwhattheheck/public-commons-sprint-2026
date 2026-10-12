"""The same explicit operations serve CLI and authenticated local HTTP."""
from pathlib import Path

from model import FIELDS, default_mapping, fail, private_directory
from workspace import Workspace
from acquisition import receive_observations, receive_source_files
from delivery import archive_package, export_package, import_package, verify_package

def call(workspace, operation, arguments):
    if not isinstance(arguments, dict):
        fail("ARGUMENT_OBJECT_REQUIRED")
    handlers = {
        "status": workspace.overview,
        "catalog": workspace.catalog,
        "source.rows": workspace.source_rows,
        "source.import": workspace.import_source,
        "source.receive_files": lambda **args: receive_source_files(workspace, **args),
        "source.receive_rows": lambda **args: receive_observations(workspace, **args),
        "mapping.template": default_mapping,
        "mapping.fields": lambda: FIELDS,
        "portfolio.freeze": lambda value: workspace.save_revision("portfolio", value),
        "mapping.freeze": lambda value: workspace.save_revision("mapping", value),
        "edition.freeze": workspace.freeze,
        "comparison.create": workspace.compare,
        "comparison.read": workspace.comparison,
        "review.keys": workspace.review_keys,
        "review.apply": workspace.review,
        "observation.read": workspace.original_row,
        "export.create": lambda **args: export_package(workspace, **args),
        "export.verify": verify_package,
        "package.import": lambda package: import_package(workspace, package),
    }
    if operation == "export.archive":
        if set(arguments) != {"export_id"}:
            fail("EXPORT_ID_REQUIRED")
        item = workspace.record("exports", arguments["export_id"])
        path = private_directory(workspace.directory / "downloads") / (arguments["export_id"] + ".zip")
        from workspace import file_identity
        from model import dump, parse, read
        receipt_path = path.with_suffix(".json")
        if path.exists() and receipt_path.exists():
            receipt = parse(read(receipt_path, 16384))
            if file_identity(path) == {key: receipt[key] for key in ("bytes", "sha256")}:
                return receipt
        path.unlink(missing_ok=True)
        receipt_path.unlink(missing_ok=True)
        receipt = archive_package(item["directory"], path)
        dump(receipt_path, receipt, exclusive=True)
        return receipt
    if operation not in handlers:
        fail("OPERATION_NOT_FOUND")
    return handlers[operation](**arguments)
