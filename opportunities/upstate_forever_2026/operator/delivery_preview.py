"""Embed declared local report images in an isolated derived HTML preview.

The original HTML and image downloads retain their exact bytes. The preview
uses only original inventory members and the operator's verified file reader.
"""
from html import escape
from html.parser import HTMLParser
import base64
import posixpath
from urllib.parse import unquote, urlsplit

HTML_LIMIT = 16 * 1024 * 1024
IMAGE_LIMIT = 16 * 1024 * 1024
IMAGES_LIMIT = 64 * 1024 * 1024
MIME_TYPES = {
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".avif": "image/avif",
}


def _image_member(value, member):
    url = urlsplit(value)
    if url.scheme or url.netloc or not url.path:
        return None
    path = unquote(url.path)
    if (path.startswith("/") or "\\" in path or ":" in path or
            any(ord(char) < 32 or ord(char) == 127 for char in path)):
        raise ValueError("Report images must reference original relative delivery members")
    path = posixpath.normpath(posixpath.join(posixpath.dirname(member), path))
    if path in {".", ".."} or path.startswith("../"):
        raise ValueError("The report image leaves its original delivery")
    return path


class _Images(HTMLParser):
    def __init__(self, source, member, inventory, read_member):
        super().__init__(convert_charrefs=False)
        self.member, self.inventory, self.read_member = member, inventory, read_member
        self.edits, self.offsets, self.cache = [], [0], {}
        self.total = 0
        for line in source.split("\n"):
            self.offsets.append(self.offsets[-1] + len(line) + 1)

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "img":
            return
        first = {}
        for key, value in attrs:
            first.setdefault(key.lower(), value)
        value = first.get("src")
        if not value:
            return
        member = _image_member(value, self.member)
        if member is None:
            return
        descriptor = self.inventory.get(member)
        if descriptor is None:
            raise ValueError("Report image is absent from the original delivery: " + member)
        mime = MIME_TYPES.get(posixpath.splitext(member)[1].lower())
        if mime is None:
            raise ValueError("Use the original download for this report image format: " + member)
        size = descriptor["bytes"]
        if size > IMAGE_LIMIT or self.total + size > IMAGES_LIMIT:
            raise ValueError("Report images exceed inline preview capacity. Open the complete offline delivery.")
        self.total += size
        if member not in self.cache:
            body = self.read_member(member, IMAGE_LIMIT)
            if len(body) != size:
                raise ValueError("Report image changed while opening its original bytes")
            self.cache[member] = "data:" + mime + ";base64," + base64.b64encode(body).decode("ascii")
        amended = []
        replaced = False
        for key, item in attrs:
            if key.lower() == "src":
                if replaced:
                    continue
                item, replaced = self.cache[member], True
            # The retained default image remains visible without authenticated
            # network requests from an opaque iframe's responsive alternatives.
            if key.lower() in {"srcset", "crossorigin"}:
                continue
            amended.append(" " + key if item is None else
                           " " + key + '="' + escape(item, quote=True) + '"')
        line, column = self.getpos()
        start = self.offsets[line - 1] + column
        self.edits.append((start, start + len(self.get_starttag_text()),
                           "<img" + "".join(amended) + ">"))

    handle_startendtag = handle_starttag


def embed_images(source, member, inventory, read_member):
    parser = _Images(source, member, inventory, read_member)
    parser.feed(source)
    parser.close()
    for start, end, replacement in reversed(parser.edits):
        source = source[:start] + replacement + source[end:]
    return source, bool(parser.edits)


def image_policy(policy):
    """Admit embedded verified images while retaining other source directives."""
    parts = [part.strip().split() for part in policy.split(";") if part.strip()]
    effective = next((part for part in parts if part[0].lower() == "img-src"), None)
    fallback = next((part for part in parts if part[0].lower() == "default-src"), None)
    if effective is None and fallback is None:
        return policy
    sources = (effective or fallback)[1:]
    if "data:" in sources:
        return policy
    amended = [value for value in sources if value != "'none'"] + ["data:"]
    if effective is None:
        parts.append(["img-src", *amended])
    else:
        effective[:] = [effective[0], *amended]
    return "; ".join(" ".join(part) for part in parts)
