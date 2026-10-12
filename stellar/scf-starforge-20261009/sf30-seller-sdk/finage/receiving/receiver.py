#!/usr/bin/env python3
"""Receive a complete original Finage delivery using the shared customer warehouse."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / "databento" / "receiving" / "receiver.py"
MODULE_NAME = "_commons_customer_receiving_engine"
engine = sys.modules.get(MODULE_NAME)
if engine is None or Path(engine.__file__).resolve() != SOURCE:
    spec = importlib.util.spec_from_file_location(MODULE_NAME, SOURCE)
    if spec is None or spec.loader is None:
        raise ImportError("The original shared customer receiving engine is required: " + str(SOURCE))
    engine = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = engine
    spec.loader.exec_module(engine)

PROFILE = engine.FINAGE
ReceivingError = engine.ReceivingError
SCHEMA = PROFILE.warehouse_schema
DELIVERY = PROFILE.delivery_schema
APPLICATION_ID = PROFILE.application_id
BATCH = engine.BATCH
dumps = engine.dumps
parse_exact = engine.parse_exact
dump_exact = engine.dump_exact
table_for = engine.table_for
identity = engine.identity


class Warehouse(engine.Warehouse):
    DEFAULT_PROFILE = PROFILE


def read_delivery(directory):
    return engine.read_delivery(directory, PROFILE)


def render_overview(inspection, page, receipt, decisions):
    return engine.render_overview(inspection, page, receipt, decisions, PROFILE)


def restore(bundle, directory):
    return engine.restore(bundle, directory, PROFILE)


def main(argv=None):
    return engine.main(argv, profile=PROFILE)


if __name__ == "__main__":
    try:
        print(dumps(main()))
    except (ReceivingError, OSError, engine.sqlite3.Error, engine.csv.Error,
            engine.json.JSONDecodeError, UnicodeError) as error:
        print(dumps({"error": {"code": getattr(error, "code", type(error).__name__),
                               "message": str(error)}}), file=sys.stderr)
        sys.exit(1)
