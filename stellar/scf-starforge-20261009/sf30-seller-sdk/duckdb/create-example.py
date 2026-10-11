#!/usr/bin/env python3
"""Create new fictional local DuckDB and Parquet merchant files; never replace a directory."""
import json
import shutil
import sys
from pathlib import Path


def create(directory):
    import duckdb
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    database = directory / "merchant.duckdb"
    connection = duckdb.connect(str(database))
    try:
        connection.execute("CREATE TABLE products(id BIGINT, title VARCHAR, region VARCHAR, price DECIMAL(38,6), internal_note VARCHAR)")
        connection.executemany("INSERT INTO products VALUES (?, ?, ?, CAST(? AS DECIMAL(38,6)), ?)", [
            (1, "Example sensor", "north", "499.000000", "private example note"),
            (2, "東京 demo", "north", "900719925474099312345.123456", "excluded by projection"),
            (3, "Example cable", "south", "19.990000", "internal"),
            (4, "Example bracket", "north", "35.010000", "internal"),
        ])
        connection.sql("SELECT * FROM (VALUES ('north', CAST('499.000000' AS DECIMAL(38,6))), ('north', CAST('100.010000' AS DECIMAL(38,6))), ('south', CAST('19.990000' AS DECIMAL(38,6)))) AS events(region, amount)").write_parquet(str(directory / "events.parquet"))
        connection.execute("CHECKPOINT")
    finally:
        connection.close()
    for source, name in [("example-source.json", "source.json"), ("example-service.json", "service.json"), ("example-input.json", "input.json")]:
        shutil.copyfile(Path(__file__).with_name(source), directory / name)
    for file in directory.iterdir():
        if file.is_file():
            file.chmod(0o600)
    print(json.dumps({"created": True, "engineVersion": duckdb.__version__, "databaseFiles": 1, "parquetFiles": 1, "queries": 2, "fictionalData": True}))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python duckdb/create-example.py NEW_DIRECTORY")
    try:
        create(Path(sys.argv[1]).resolve())
    except Exception:
        print(json.dumps({"error": "DUCKDB_EXAMPLE_NOT_CREATED"}), file=sys.stderr)
        raise SystemExit(1)
