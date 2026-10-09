"""One focused synthetic check: frozen frame cannot count as independent proof.

Run from opencv26-palletgap/: PYTHONPATH=. python focus/identical_confirmation.py
No camera, network, AWS, or repository-wide test invocation.
"""
from pathlib import Path
from tempfile import TemporaryDirectory

from palletgap.demo import generate
from palletgap.vision import orchestrate, read_image


def main() -> None:
    with TemporaryDirectory() as folder:
        out = Path(folder)
        setup = generate(out)
        reference = read_image(str(out / "reference.png"))
        blocked = read_image(str(out / "blocked.png"))
        fresh = read_image(str(out / "confirmation.png"))
        aisle = setup["camera"]["aisle_polygon"]

        replay = orchestrate(reference, blocked, aisle, blocked.copy())
        assert replay["decision"] == "RETAKE_REQUIRED", replay
        assert replay["reason"] == "confirmation_frame_identical", replay
        assert replay["next_action"] == "capture_new_confirmation_frame", replay

        genuine = orchestrate(reference, blocked, aisle, fresh)
        assert genuine["decision"] == "HUMAN_REVIEW_REQUIRED", genuine
        print("focused confirmation: identical retake / independent synthetic review PASS")


if __name__ == "__main__":
    main()
