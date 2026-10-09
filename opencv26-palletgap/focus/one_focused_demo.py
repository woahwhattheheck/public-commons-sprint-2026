"""One bounded synthetic source execution (not OpenCV5/AWS qualification)."""
from __future__ import annotations
import tempfile
from pathlib import Path

from palletgap.demo import generate
from palletgap.vision import orchestrate, read_image


def main() -> None:
    with tempfile.TemporaryDirectory() as root:
        fixture = Path(root)
        data = generate(fixture)
        vertices = data["camera"]["aisle_polygon"]
        baseline = read_image(str(fixture / "reference.png"))
        clear = orchestrate(baseline, read_image(str(fixture / "clear.png")), vertices)
        first = orchestrate(baseline, read_image(str(fixture / "blocked.png")), vertices)
        confirmed = orchestrate(baseline, read_image(str(fixture / "blocked.png")), vertices, read_image(str(fixture / "confirmation.png")))
        assert clear["decision"] == "OBSERVED_NO_CHANGE", clear
        assert first["decision"] == "SECOND_VIEW_REQUIRED", first
        assert confirmed["decision"] == "HUMAN_REVIEW_REQUIRED", confirmed
        assert confirmed["persistent_regions"] >= 1, confirmed
        print("FOCUSED DEMO PASS: clear→OBSERVED_NO_CHANGE; blocked→SECOND_VIEW_REQUIRED; confirmed→HUMAN_REVIEW_REQUIRED")
        print("inliers(clear/blocked/confirmation):", clear["first"]["registration"].get("inliers"), first["first"]["registration"].get("inliers"), confirmed["second"]["registration"].get("inliers"))


if __name__ == "__main__":
    main()
