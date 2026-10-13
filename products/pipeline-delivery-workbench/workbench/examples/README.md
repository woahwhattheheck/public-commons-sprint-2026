# Original local project example

The jaffle_shop directory retains the selected dbt Labs SQL, YAML, seed CSVs, original README and Apache-2.0 LICENSE unchanged. The original repository is https://github.com/dbt-labs/jaffle_shop_duckdb, branch duckdb. SOURCE.json contains the immutable tree and every selected original blob/byte hash. The data describes dbt Labs’ fictional Jaffle Shop and is used only to operate this application locally. It is not Snowpack or Replo customer information.

The selected original project requires dbt >=1.11 and <2.0. The application therefore pins dbt-core1.12.5 and dbt-duckdb1.11.0, matching the primary native package versions in that project’s current requirements, plus Dagster1.13.26. Its developer-wide pyproject and linting tools are not copied into the imported dbt source. The original SQL, schema tests, documentation and CSV bytes are retained.

Create a project, import jaffle_shop with the CLI or browser, select a managed DuckDB binding, and run build with optional catalogue generation. Native build owns the models and existing data tests; the application reads the actual returned artifacts. No fabricated execution or result is shipped in the empty workspace.
