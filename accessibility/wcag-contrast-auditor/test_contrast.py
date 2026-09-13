import contextlib
import io
import json
import unittest

import contrast


class ContrastTests(unittest.TestCase):
    def test_normalize_short_hex(self):
        self.assertEqual(contrast.normalize_hex("#0aF"), "#00AAFF")
        self.assertEqual(contrast.normalize_hex("fff"), "#FFFFFF")

    def test_rejects_non_hex_and_alpha_hex(self):
        for value in ("red", "#12", "#1234", "#12345678", "#GGGGGG"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                contrast.normalize_hex(value)

    def test_black_white_is_maximum_ratio_and_order_independent(self):
        self.assertAlmostEqual(contrast.contrast_ratio("#000", "#fff"), 21.0, places=12)
        self.assertAlmostEqual(contrast.contrast_ratio("#fff", "#000"), 21.0, places=12)

    def test_identical_colors_have_ratio_one(self):
        self.assertAlmostEqual(contrast.contrast_ratio("#336699", "#336699"), 1.0, places=12)

    def test_aa_normal_threshold_boundary_examples(self):
        # #767676 on white is just above 4.5:1; #777777 is just below it.
        self.assertTrue(contrast.evaluate("#767676", "#FFFFFF").passes)
        self.assertFalse(contrast.evaluate("#777777", "#FFFFFF").passes)

    def test_large_text_and_aaa_thresholds(self):
        result = contrast.evaluate("#777", "#fff", level="AA", large_text=True)
        self.assertTrue(result.passes)
        self.assertEqual(result.threshold, 3.0)
        self.assertFalse(contrast.evaluate("#777", "#fff", level="AAA").passes)
        self.assertTrue(contrast.evaluate("#000", "#fff", level="AAA").passes)

    def test_invalid_level_rejected_for_library_call(self):
        with self.assertRaises(ValueError):
            contrast.evaluate("#000", "#fff", level="A")

    def test_json_cli_shape_and_exit_status(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = contrast.main(["#000", "#fff", "--json"])
        self.assertEqual(status, 0)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["foreground"], "#000000")
        self.assertEqual(payload["background"], "#FFFFFF")
        self.assertEqual(payload["ratio"], 21.0)
        self.assertTrue(payload["passes"])

    def test_cli_failure_exit_is_one(self):
        with contextlib.redirect_stdout(io.StringIO()):
            status = contrast.main(["#777", "#fff"])
        self.assertEqual(status, 1)

    def test_cli_invalid_color_is_usage_error(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as raised:
                contrast.main(["not-a-color", "#fff"])
        self.assertEqual(raised.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
