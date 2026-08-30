import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RENDER_PATH = ROOT / "render.py"
TEMPLATE = ROOT / "source-bound-public-brief.prompt.md"
VALUES = ROOT / "examples" / "source-bound-public-brief.values.json"

SPEC = importlib.util.spec_from_file_location("commons_prompt_render", RENDER_PATH)
RENDER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(RENDER)


class OfflinePromptRendererTests(unittest.TestCase):
    def test_example_values_render_every_placeholder(self):
        template = TEMPLATE.read_text(encoding="utf-8")
        values = RENDER.read_values(VALUES)
        rendered = RENDER.render(template, values)
        self.assertNotRegex(rendered, RENDER.PLACEHOLDER)
        self.assertIn("[S1] Flyer", rendered)
        self.assertIn("Evidence boundary: This brief uses only the supplied source packet.", rendered)

    def test_cli_writes_rendered_prompt_to_stdout(self):
        result = subprocess.run(
            [sys.executable, str(RENDER_PATH), str(TEMPLATE), str(VALUES)],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertNotIn("{{", result.stdout)
        self.assertIn("Plain-text bulletin", result.stdout)

    def test_missing_value_is_reported_without_partial_output(self):
        values = RENDER.read_values(VALUES)
        values.pop("GOAL")
        with self.assertRaisesRegex(ValueError, "missing values: GOAL"):
            RENDER.render(TEMPLATE.read_text(encoding="utf-8"), values)

    def test_cli_failure_emits_no_partial_prompt(self):
        values = RENDER.read_values(VALUES)
        values.pop("GOAL")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "values.json"
            path.write_text(json.dumps(values), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(RENDER_PATH), str(TEMPLATE), str(path)],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("missing values: GOAL", result.stderr)

    def test_unused_value_is_reported(self):
        values = RENDER.read_values(VALUES)
        values["EXTRA"] = "unused"
        with self.assertRaisesRegex(ValueError, "unused values: EXTRA"):
            RENDER.render(TEMPLATE.read_text(encoding="utf-8"), values)

    def test_non_object_json_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "values.json"
            path.write_text(json.dumps(["not", "an", "object"]), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "one object"):
                RENDER.read_values(path)


if __name__ == "__main__":
    unittest.main()
