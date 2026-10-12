#!/usr/bin/env python3
"""Render the editable course diagram layout to native PNG and SVG backgrounds."""
from __future__ import annotations
import argparse, html, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def font(size, bold=False):
    names = ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
             "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()

def render(root):
    source = root / "images" / "diagrams.json"
    packet = json.loads(source.read_text(encoding="utf-8"))
    results = []
    for d in packet["diagrams"]:
        image = Image.new("RGB", (d["width"], d["height"]), "white")
        draw = ImageDraw.Draw(image)
        draw.text((16, 3), d["title"], font=font(17, True), fill="#111111")
        draw.text((16, 26), d["subtitle"], font=font(12), fill="#111111")
        esc = html.escape
        svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{d["width"]}" height="{d["height"]}" viewBox="0 0 {d["width"]} {d["height"]}" role="img" aria-labelledby="title desc">',
               f'<title id="title">{esc(d["title"])}</title>',
               '<desc id="desc">' + esc(" ".join(c["key"] + ": " + " ".join(c["lines"]) for c in d["cards"])) + '</desc>',
               '<rect width="100%" height="100%" fill="#fff"/>',
               '<g font-family="DejaVu Sans, sans-serif" fill="#111">',
               f'<text x="16" y="20" font-size="17" font-weight="bold">{esc(d["title"])}</text>',
               f'<text x="16" y="39" font-size="12">{esc(d["subtitle"])}</text>']
        for c in d["cards"]:
            x,y,w,h = c["x"],c["y"],c["width"],c["height"]
            draw.rectangle((x,y,x+w,y+h), fill="#fafafa", outline="#555555", width=1)
            draw.text((x+12,y+6), c["key"], font=font(16, True), fill="#111111")
            svg += [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#fafafa" stroke="#555"/>',
                    f'<text x="{x+12}" y="{y+23}" font-size="16" font-weight="bold">{c["key"]}</text>']
            for i,line in enumerate(c["lines"]):
                if draw.textbbox((0,0),line,font=font(14))[2] > w-24:
                    raise ValueError(f'{d["id"]}: source line exceeds its panel: {line}')
                draw.text((x+12,y+33+i*20),line,font=font(14),fill="#111111")
                svg.append(f'<text x="{x+12}" y="{y+48+i*20}" font-size="14">{esc(line)}</text>')
            dx,dy = c["drop"]["x"]-4,c["drop"]["y"]-5
            draw.rectangle((dx,dy,dx+270,dy+32), fill="white", outline="#777777",width=1)
            svg.append(f'<rect x="{dx}" y="{dy}" width="270" height="32" fill="#fff" stroke="#777" stroke-dasharray="4 3"/>')
        for a in d.get("arrows",[]):
            draw.line((a["x1"],a["y1"],a["x2"],a["y2"]),fill="#333333",width=2)
            draw.line((a["x2"]-6,a["y2"]-4,a["x2"],a["y2"],a["x2"]-6,a["y2"]+4),fill="#333333",width=2)
            svg.append(f'<path d="M{a["x1"]} {a["y1"]} L{a["x2"]} {a["y2"]} m-6 -4 l6 4 -6 4" fill="none" stroke="#333" stroke-width="2"/>')
        svg += ['</g>','</svg>']
        for name in (d["png"],d["svg"]):
            target = (root/name).resolve()
            if not target.is_relative_to(root.resolve()):
                raise ValueError("Diagram output must remain beneath curriculum")
            target.parent.mkdir(parents=True,exist_ok=True)
        image.save(root/d["png"],format="PNG",optimize=True)
        (root/d["svg"]).write_text("\n".join(svg)+"\n",encoding="utf-8")
        results.append({"id":d["id"],"png":d["png"],"svg":d["svg"],"width":d["width"],"height":d["height"]})
    return results

if __name__ == "__main__":
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--curriculum",type=Path,default=Path(__file__).resolve().parent)
    args=p.parse_args()
    print(json.dumps(render(args.curriculum),indent=2))
