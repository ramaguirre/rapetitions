"""Draws the app icons (icons/icon-192.png, icons/icon-512.png): a loop arrow around an R."""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG, FG, ACCENT = (15, 17, 21), (244, 245, 247), (56, 211, 159)


def icon(size):
    s = 4 * size  # draw large, shrink for smooth edges
    im = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(im)
    c, r, w = s / 2, s * 0.30, s * 0.055  # inside the maskable safe zone (80 %)
    d.arc([c - r, c - r, c + r, c + r], start=-60, end=250, fill=ACCENT, width=int(w))
    a = math.radians(-60)  # arrow head at the arc's start, pointing along the loop
    tip = (c + r * math.cos(a), c + r * math.sin(a))
    ang = a - math.pi / 2
    L = s * 0.11
    pts = [
        (tip[0] + L * math.cos(ang), tip[1] + L * math.sin(ang)),
        (tip[0] + 0.75 * L * math.cos(ang + 2.3), tip[1] + 0.75 * L * math.sin(ang + 2.3)),
        (tip[0] + 0.75 * L * math.cos(ang - 2.3), tip[1] + 0.75 * L * math.sin(ang - 2.3)),
    ]
    d.polygon(pts, fill=ACCENT)
    font = None
    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf"):
        try:
            font = ImageFont.truetype(name, int(s * 0.34))
            break
        except OSError:
            pass
    d.text((c, c), "R", fill=FG, font=font or ImageFont.load_default(), anchor="mm")
    return im.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for n in (192, 512):
        icon(n).save(out / f"icon-{n}.png", optimize=True)
