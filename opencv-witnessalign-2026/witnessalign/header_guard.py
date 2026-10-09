"""Reject unsupported or oversized image dimensions before OpenCV allocates pixels.

This is a narrow PNG IHDR / JPEG SOF admission check, not a decoder or a
substitute for the post-decode dimensions check. No third-party dependencies.
"""
from __future__ import annotations

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Start-of-frame markers with a common precision/height/width prefix.
JPEG_SOF = frozenset((0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF))


class ImageHeaderError(ValueError):
    """Input cannot be admitted as a bounded PNG or JPEG."""


def _dimensions(payload: bytes) -> tuple[int, int]:
    if payload.startswith(PNG_SIGNATURE):
        # PNG IHDR MUST be the first chunk: length 13 and then width/height.
        if (len(payload) < 33 or payload[8:12] != b"\x00\x00\x00\x0d"
                or payload[12:16] != b"IHDR"):
            raise ImageHeaderError("malformed or truncated PNG IHDR")
        return (int.from_bytes(payload[16:20], "big"),
                int.from_bytes(payload[20:24], "big"))

    if not payload.startswith(b"\xff\xd8"):
        raise ImageHeaderError("only PNG and JPEG image containers are supported")

    pos = 2
    while pos < len(payload):
        if payload[pos] != 0xFF:
            raise ImageHeaderError("malformed JPEG marker stream")
        while pos < len(payload) and payload[pos] == 0xFF:
            pos += 1  # JPEG allows FF fill between markers.
        if pos == len(payload):
            break
        marker = payload[pos]
        pos += 1
        if marker in (0xD9, 0xDA):  # EOI or compressed scan before SOF.
            break
        if marker in (0x01, 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7):
            continue  # standalone markers have no length field.
        if pos + 2 > len(payload):
            raise ImageHeaderError("truncated JPEG segment length")
        size = int.from_bytes(payload[pos:pos + 2], "big")
        if size < 2 or pos + size > len(payload):
            raise ImageHeaderError("invalid or truncated JPEG segment")
        if marker in JPEG_SOF:
            if size < 8:
                raise ImageHeaderError("malformed JPEG frame header")
            return (int.from_bytes(payload[pos + 5:pos + 7], "big"),
                    int.from_bytes(payload[pos + 3:pos + 5], "big"))
        pos += size
    raise ImageHeaderError("JPEG lacks a complete start-of-frame header")


def admit_image_header(payload: bytes, *, min_side: int, max_side: int,
                       max_pixels: int) -> tuple[int, int]:
    """Return (width, height) or reject before cv2.imdecode is invoked."""
    if not isinstance(payload, bytes):
        raise ImageHeaderError("image payload must be bytes")
    width, height = _dimensions(payload)
    if (min(width, height) < min_side or max(width, height) > max_side
            or width * height > max_pixels):
        raise ImageHeaderError("dimensions outside admitted range")
    return width, height
