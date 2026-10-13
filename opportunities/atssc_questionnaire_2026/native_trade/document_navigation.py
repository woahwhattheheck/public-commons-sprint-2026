"""Word/PDF navigation helpers for the original document exporter.

Bookmarks and links are constructed from the selected renderer model.  No
workspace state or external document is consulted during a download.
"""
from __future__ import annotations

from xml.sax.saxutils import escape

_NAVIGATION_PARAGRAPH = None


def word_bookmark(paragraph, key, identifier):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), str(identifier))
    start.set(qn("w:name"), key)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), str(identifier))
    properties = paragraph._p.find(qn("w:pPr"))
    if properties is None:
        paragraph._p.insert(0, start)
    else:
        paragraph._p.insert(1, start)
    paragraph._p.append(end)


def word_contents(document, reading):
    """Insert editable internal links with a complete top-level reading order."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt
    document.add_paragraph(reading["labels"]["contents"], "Heading 1")
    for entry in reading["contents"]:
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(4)
        link = OxmlElement("w:hyperlink")
        link.set(qn("w:anchor"), entry["key"])
        link.set(qn("w:history"), "1")
        run = OxmlElement("w:r")
        properties = OxmlElement("w:rPr")
        color = OxmlElement("w:color")
        color.set(qn("w:val"), "202020")
        properties.append(color)
        underline = OxmlElement("w:u")
        underline.set(qn("w:val"), "single")
        properties.append(underline)
        run.append(properties)
        text = OxmlElement("w:t")
        text.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
        text.text = entry["title"]
        run.append(text)
        link.append(run)
        paragraph._p.append(link)


def word_language(document, language):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    locale = "fr-CA" if language == "fr" else "en-CA"
    for name in ("Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3"):
        properties = document.styles[name].element.get_or_add_rPr()
        current = properties.find(qn("w:lang"))
        if current is None:
            current = OxmlElement("w:lang")
            properties.append(current)
        current.set(qn("w:val"), locale)
    document.core_properties.language = locale


def pdf_heading(text, style, entry):
    """A single destination backs both the outline and the linked contents."""
    global _NAVIGATION_PARAGRAPH
    if _NAVIGATION_PARAGRAPH is None:
        from reportlab.platypus import Paragraph
        class NavigationParagraph(Paragraph):
            def split(self, available_width, available_height):
                parts = super().split(available_width, available_height)
                if parts and hasattr(self, "_native_trade_outline"):
                    parts[0]._native_trade_outline = self._native_trade_outline
                return parts
        _NAVIGATION_PARAGRAPH = NavigationParagraph
    paragraph = _NAVIGATION_PARAGRAPH('<a name="' + entry["key"] + '"/>' + escape(str(text)).replace("\n", "<br/>"), style)
    paragraph._native_trade_outline = entry
    return paragraph


def pdf_contents(reading, styles):
    from reportlab.platypus import Paragraph, Spacer
    rows = [Paragraph(escape(reading["labels"]["contents"]), styles["heading"])]
    for entry in reading["contents"]:
        rows.append(Paragraph(
            '<link href="#' + entry["key"] + '" color="#202020">' + escape(entry["title"]) + "</link>",
            styles["contents"],
        ))
    rows.append(Spacer(1, 10))
    return rows


def install_pdf_outline(document):
    """Attach actual page destinations to either maintained PDF template."""
    previous = document.afterFlowable
    def after(flowable):
        previous(flowable)
        entry = getattr(flowable, "_native_trade_outline", None)
        if entry:
            # Paragraph anchors preserve the actual rendered destination.
            document.canv.addOutlineEntry(entry["title"], entry["key"], entry["level"], closed=entry["level"] == 0)
    document.afterFlowable = after
