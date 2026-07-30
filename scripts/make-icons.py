"""Generate the app icons: a scrap of seyes paper with a large e-acute in ink,
sitting on the ruling, red margin line at the left.

Run once, or again after the palette changes:

    python scripts/make-icons.py

Needs Pillow. The palette is read from src/styles.css rather than repeated here,
so the icons cannot drift away from the interface.
"""

import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit(
        "Pillow is not installed, so the icons cannot be drawn.\n"
        "Run: python -m pip install Pillow"
    )

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "src" / "styles.css"
ICONS = ROOT / "icons"

# Supersample, then downscale. Pillow does not antialias primitives.
SS = 4

# The display face in styles.css, then the fallbacks from that same font stack.
FONT_CANDIDATES = [
    "InstrumentSerif-Regular.ttf",
    "Georgia.ttf",
    "georgia.ttf",
    "Times New Roman.ttf",
    "times.ttf",
    "DejaVuSerif.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]

NEEDED = ["--paper-sheet", "--seyes", "--seyes-faint", "--marge", "--ink"]


def read_palette():
    if not STYLES.exists():
        sys.exit(f"Could not read {STYLES}. Run this from the repo, not from elsewhere.")
    css = STYLES.read_text(encoding="utf-8")
    palette = {}
    for token in NEEDED:
        match = re.search(rf"{token}\s*:\s*(#[0-9A-Fa-f]{{6}})", css)
        if not match:
            sys.exit(
                f"{token} is missing from src/styles.css, so the icon has no colour for it.\n"
                f"Add the token to :root, then run this script again."
            )
        palette[token] = match.group(1)
    return palette


def load_font(px):
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            continue
    return None


def fit_font(target_height):
    """Grow a serif face until e-acute reaches the target height."""
    px = target_height
    for _ in range(40):
        font = load_font(int(px))
        if font is None:
            return None, None
        box = font.getbbox("é")
        height = box[3] - box[1]
        if height == 0:
            return None, None
        if abs(height - target_height) <= target_height * 0.01:
            return font, box
        px *= target_height / height
    return font, font.getbbox("é")


def draw_icon(size, palette, maskable=False):
    W = size * SS
    img = Image.new("RGB", (W, W), palette["--paper-sheet"])
    draw = ImageDraw.Draw(img)

    # A maskable icon gets cropped to whatever shape the platform likes, so the
    # e-acute and the margin line stay inside the centre 80 percent. The paper
    # itself is full bleed either way, which is why there is no transparency.
    inset = W * 0.11 if maskable else 0.0
    box_left, box_right = inset, W - inset
    box_top, box_bottom = inset, W - inset
    box_w = box_right - box_left
    box_h = box_bottom - box_top

    strong_pitch = box_w * 0.25
    faint_pitch = strong_pitch / 4          # four millimetre lines per seyes line
    baseline = box_top + box_h * 0.70

    faint_w = max(1, int(W * 0.004))
    strong_w = max(1, int(W * 0.007))

    # Ruling runs edge to edge. Clipping the texture at the rim is fine.
    k = -12
    while baseline + k * faint_pitch < W + faint_pitch:
        y = baseline + k * faint_pitch
        k += 1
        if 0 <= y <= W:
            draw.line([(0, y), (W, y)], fill=palette["--seyes-faint"], width=faint_w)

    k = -6
    while baseline + k * strong_pitch < W + strong_pitch:
        y = baseline + k * strong_pitch
        k += 1
        if 0 <= y <= W:
            draw.line([(0, y), (W, y)], fill=palette["--seyes"], width=strong_w)

    margin_x = box_left + box_w * 0.16
    draw.line(
        [(margin_x, 0), (margin_x, W)],
        fill=palette["--marge"],
        width=max(1, int(W * 0.016)),
    )

    font, box = fit_font(box_h * 0.46)
    if font is None:
        sys.exit(
            "No serif font was found, so the e-acute cannot be drawn.\n"
            "Install Georgia or DejaVu Serif, or add a face to FONT_CANDIDATES."
        )

    # Centre the glyph in the paper to the right of the margin line, and sit it
    # on the baseline rather than centring it vertically.
    glyph_w = box[2] - box[0]
    text_x = margin_x + (box_right - margin_x - glyph_w) / 2 - box[0]
    draw.text((text_x, baseline), "é", font=font, fill=palette["--ink"], anchor="ls")

    return img.resize((size, size), Image.LANCZOS)


def main():
    palette = read_palette()
    ICONS.mkdir(exist_ok=True)

    font_check = load_font(64)
    if font_check is None:
        sys.exit(
            "No serif font was found, so the e-acute cannot be drawn.\n"
            "Install Georgia or DejaVu Serif, or add a face to FONT_CANDIDATES."
        )
    print(f"drawing with {font_check.getname()[0]}")

    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-512-maskable.png", 512, True),
    ]
    for name, size, maskable in targets:
        path = ICONS / name
        draw_icon(size, palette, maskable=maskable).save(path, "PNG", optimize=True)
        print(f"wrote icons/{name} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
