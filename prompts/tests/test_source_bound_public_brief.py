import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "source-bound-public-brief.prompt.md"
EXAMPLE = ROOT / "examples" / "source-bound-public-brief.example.md"
PLACEHOLDER = re.compile(r"\{\{([A-Z_]+)\}\}")


VALUES = {
    "AUDIENCE": "Residents who use the neighborhood cooling room",
    "GOAL": "Explain measured hours and identify evidence gaps",
    "FORMAT": "Plain-text bulletin",
    "WORD_LIMIT": "180 words",
    "CONSTRAINTS": "Use short sentences; do not imply unlisted services",
    "EXPERT_REVIEW_TOPICS": "Accessibility and heat-safety advice",
    "SOURCE_PACKET": (
        "[S1] Flyer: Open Tuesday and Thursday, 14:00–18:00.\n"
        "[S2] Facilities note: Step-free entrance status has not been measured.\n"
        "[S3] Transit note: Bus route information was not supplied."
    ),
}


def render(text, values):
    return PLACEHOLDER.sub(lambda match: values[match.group(1)], text)


class SourceBoundPublicBriefTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = TEMPLATE.read_text(encoding="utf-8")
        cls.example = EXAMPLE.read_text(encoding="utf-8")

    def test_template_uses_exact_documented_placeholders(self):
        self.assertEqual(set(PLACEHOLDER.findall(self.template)), set(VALUES))

    def test_example_render_has_no_unresolved_placeholder(self):
        rendered = render(self.template, VALUES)
        self.assertNotRegex(rendered, PLACEHOLDER)
        for value in VALUES.values():
            self.assertIn(value, rendered)

    def test_evidence_and_uncertainty_contract_is_present(self):
        required = (
            "**supported**, **inference**, or **unknown**",
            "Never create a URL",
            "Do not expose personal data",
            "Needs expert review",
            "**Unknowns and conflicts**",
            "Evidence boundary: This brief uses only the supplied source packet.",
        )
        for phrase in required:
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, self.template)

    def test_example_names_the_three_source_labels_and_no_real_contact_data(self):
        for label in ("[S1]", "[S2]", "[S3]"):
            self.assertIn(label, self.example)
        self.assertNotRegex(self.example, r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
        self.assertNotRegex(self.example, r"\+?\d[\d ()-]{7,}\d")


if __name__ == "__main__":
    unittest.main()
