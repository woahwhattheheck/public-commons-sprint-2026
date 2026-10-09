"""One focused predecode-admission check; synthetic, not an accuracy benchmark."""
from __future__ import annotations

import unittest

import cv2
import numpy as np
from witnessalign.header_guard import ImageHeaderError, admit_image_header


class HeaderAdmissionTests(unittest.TestCase):
    def admit(self, image: bytes):
        return admit_image_header(image, min_side=160, max_side=2600,
                                  max_pixels=5_000_000)

    def test_admit_genuine_png_and_baseline_and_progressive_jpeg(self):
        # Synthetic valid image encodings exercise real OpenCV byte writers.
        pixels = np.random.default_rng(42).integers(0, 256, (180, 200, 3), dtype=np.uint8)
        for extension, opts in ((".png", []), (".jpg", [cv2.IMWRITE_JPEG_QUALITY, 90]),
                                (".jpg", [cv2.IMWRITE_JPEG_PROGRESSIVE, 1])):
            with self.subTest(extension=extension, opts=opts):
                ok, encoded = cv2.imencode(extension, pixels, opts)
                self.assertTrue(ok)
                self.assertEqual(self.admit(encoded.tobytes()), (200, 180))

    def test_png_huge_ihdr_rejected_before_any_decoder_allocation(self):
        # Not a valid full PNG: size fence must reject from the bounded header alone.
        fake = (b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR"
                + (50_000).to_bytes(4, "big") + (50_000).to_bytes(4, "big")
                + b"\x08\x02\x00\x00\x00" + b"\x00\x00\x00\x00")
        with self.assertRaisesRegex(ImageHeaderError, "dimensions outside"):
            self.admit(fake)

    def test_jpeg_huge_sof_rejected_before_decoder(self):
        sof = (b"\xff\xd8\xff\xc0" + (17).to_bytes(2, "big")
               + b"\x08" + (10_000).to_bytes(2, "big")
               + (10_000).to_bytes(2, "big") + b"\x03"
               + b"\x01\x11\x00\x02\x11\x00\x03\x11\x00")
        with self.assertRaisesRegex(ImageHeaderError, "dimensions outside"):
            self.admit(sof)

    def test_malformed_containers_and_segments_fail_closed(self):
        invalid = (
            b"GIF89a" + b"\x00" * 40,
            b"\x89PNG\r\n\x1a\n" + b"\x00" * 25,
            b"\xff\xd8\xff\xe1\x00\x01junk",   # invalid APP length
            b"\xff\xd8\xff\xe1\x00\x10abc",    # truncated APP segment
            b"\xff\xd8\x01\x02",               # missing marker introducer
            b"\xff\xd8\xff\xd9",               # no SOF before end of image
            b"\xff\xd8\xff\xda\x00\x02",       # no SOF before start of scan
            b"\xff\xd8\xff\xc0\x00\x07\x08\x00\xb4\x00\xc8",
        )
        for image in invalid:
            with self.subTest(image=image[:16]):
                with self.assertRaises(ImageHeaderError):
                    self.admit(image)

    def test_pixel_limit_catches_broad_but_individually_admitted_sides(self):
        # Each side <=2600 but 2300^2 >5M.
        fake = (b"\x89PNG\r\n\x1a\n" + (13).to_bytes(4, "big") + b"IHDR"
                + (2300).to_bytes(4, "big") * 2
                + b"\x08\x02\x00\x00\x00" + b"\x00\x00\x00\x00")
        with self.assertRaisesRegex(ImageHeaderError, "dimensions outside"):
            self.admit(fake)

if __name__ == "__main__":
    unittest.main()
