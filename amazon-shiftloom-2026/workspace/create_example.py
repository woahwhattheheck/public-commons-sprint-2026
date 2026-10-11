from pathlib import Path
import argparse, base64, json, shlex
from sources import WorkError, fail, json_text
from store import Workspace, HERE


def populate_example(filename):
    workspace = Workspace(filename)
    try:
        state = workspace.state()
        if state["revision"] or state["datasets"] or state["boards"]:
            fail("EXAMPLE_EXISTING_WORKSPACE", "Choose a new workspace file for the worked example.", 409)
        revision = 0
        def write(method, body):
            nonlocal revision
            result = method(dict(expected_revision=revision, **body))
            revision = result["revision"]
            return result
        examples = HERE / "examples"
        recipe = json.loads((examples / "recipe.json").read_text())
        write(workspace.settings, dict(settings=recipe["settings"]))
        native = write(workspace.native_snapshot, dict(name="getconnected-snapshot.json",
            content_b64=base64.b64encode((examples / "getconnected-snapshot.json").read_bytes()).decode()))
        for dataset in native["datasets"]:
            role, ident = dataset["role"], dataset["id"]
            write(lambda body: workspace.mapping(ident, body), recipe["native_mappings"][role])
            if role in recipe["native_overrides"]:
                write(lambda body: workspace.overrides(ident, body), dict(actor="Worked-example coordinator",
                    note="Explicit weekly limits, team reservation and context shifts from the supplied recipe.",
                    rows=recipe["native_overrides"][role]))
        upload = write(workspace.upload, dict(role="availability", name="availability.csv", format="csv",
            content_b64=base64.b64encode((examples / "availability.csv").read_bytes()).decode()))
        ident = upload["dataset_id"]
        write(lambda body: workspace.mapping(ident, body), recipe["csv_mappings"]["availability"])
        board = write(workspace.create_board, dict(label="Worked example: original coverage"))
        return dict(db=str(workspace.path), board_id=board["board_id"], revision=revision,
                    start_command=shlex.join(["python3", "-B", "app.py", "--db", str(workspace.path), "--port", "8802"]))
    finally:
        workspace.close()


def main():
    parser = argparse.ArgumentParser(description="Create a fresh retained workspace from the supplied operating example")
    parser.add_argument("--db", required=True)
    args = parser.parse_args()
    try:
        print(json_text(populate_example(args.db)))
        return 0
    except WorkError as exc:
        print(json_text(dict(error=exc.code, message=exc.message)))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

