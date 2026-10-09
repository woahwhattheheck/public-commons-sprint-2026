"""One bounded synthetic smoke test only, no repository-wide test discovery."""
import unittest
from drainguard.synthetic import make_scene
from drainguard.vision import inspect

class SceneTest(unittest.TestCase):
    def test_reference_to_obstruction_reporting(self):
        ref, changed, slots = make_scene()
        result, annotation = inspect(ref, changed, slots)
        self.assertEqual(result["status"], "REVIEW_BRIGHT_BLOCKAGE")
        self.assertEqual(annotation.shape, ref.shape)
        self.assertTrue(result["human_review_required"])
        self.assertFalse(result["can_authorize_maintenance"])
        flagged = [s["slot_id"] for s in result["slots"] if s["classification"] == "REVIEW_BRIGHT_BLOCKAGE"]
        self.assertGreaterEqual(len(flagged), 1)
        self.assertTrue(set(flagged) & {"S2","S3"})

if __name__ == "__main__":
    unittest.main()
