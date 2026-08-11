"""Icon concepts for Reckon — a contact sheet to choose from.

The first icon (three bars) was a literal rendering of the probability split.
It is honest but it reads as a generic analytics or finance app: nothing about
it says football, and a home screen full of apps is exactly where that
distinction gets made.

Four directions below, each rendered large and at 29pt, because a concept that
only works at 1024px is not an app icon (CLAUDE.md §12).

Run:
    worker/.venv/Scripts/python.exe app/scripts/icon-concepts.py
Then open app/assets/_icon-concepts.png
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent.parent / "assets"

BASE = (10, 11, 13)
ACCENT = (196, 240, 0)
MID = (174, 184, 196)
DIM = (111, 122, 135)

S = 1024
FONT_BLACK = "C:/Windows/Fonts/seguibli.ttf"   # Segoe UI Black Italic
FONT_HEAVY = "C:/Windows/Fonts/ariblk.ttf"     # Arial Black


def _canvas() -> Image.Image:
    return Image.new("RGB", (S, S), BASE)


# ---------------------------------------------------------------- concept 1

def monogram() -> Image.Image:
    """A heavy R.

    What most consumer apps land on, because the icon and the name reinforce
    each other and a letterform is unmistakable at any size. Reads as a brand
    rather than as a chart.
    """
    img = _canvas()
    draw = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_HEAVY, int(S * 0.70))
    box = draw.textbbox((0, 0), "R", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1]), "R", font=font, fill=ACCENT)
    return img


# ---------------------------------------------------------------- concept 2

def pitch() -> Image.Image:
    """Centre circle and halfway line.

    Unmistakably football and legally clean — it is a pitch marking, not a
    crest or league mark (§2 [HARD]). The two halves also carry the product
    idea: you on one side, the model on the other. Downside: several football
    apps already use a pitch abstraction, so it is the least ownable here.
    """
    img = _canvas()
    draw = ImageDraw.Draw(img)

    line_w = int(S * 0.055)
    draw.rectangle([(S - line_w) / 2, S * 0.14, (S + line_w) / 2, S * 0.86], fill=ACCENT)

    r = S * 0.24
    draw.ellipse(
        [S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r],
        outline=MID,
        width=int(S * 0.055),
    )
    return img


# ---------------------------------------------------------------- concept 3

def ring() -> Image.Image:
    """The probability split as a ring.

    Same data as the bars, but a circle fills the icon frame far better than
    three uprights and stays legible when scaled down. Distinctive without
    being abstract — it reads instantly as "a proportion of something".
    """
    img = _canvas()
    draw = ImageDraw.Draw(img)

    pad = S * 0.20
    box = [pad, pad, S - pad, S - pad]
    width = int(S * 0.155)
    gap = 5  # degrees, so the segments stay separable at small sizes

    segments = [(0.55, ACCENT), (0.17, DIM), (0.28, MID)]
    angle = -90.0
    for share, colour in segments:
        sweep = share * 360.0
        draw.arc(box, angle + gap / 2, angle + sweep - gap / 2, fill=colour, width=width)
        angle += sweep
    return img


# ---------------------------------------------------------------- concept 4

def split_disc() -> Image.Image:
    """A disc cut by a hard diagonal — two sides in tension.

    The most abstract option, and the most brandable: it says "two opposing
    views" without illustrating either. Closest to §7.1's "editorial data
    terminal" register.
    """
    img = _canvas()
    draw = ImageDraw.Draw(img)

    pad = S * 0.19
    disc = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(disc)
    d.ellipse([pad, pad, S - pad, S - pad], fill=MID)
    d.polygon([(0, S), (S, 0), (S, S)], fill=ACCENT + (255,))

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([pad, pad, S - pad, S - pad], fill=255)
    img.paste(disc, (0, 0), mask)

    # Hairline through the cut so the two halves read as deliberate.
    draw.line([(0, S), (S, 0)], fill=BASE, width=int(S * 0.03))
    return img


# ---------------------------------------------------------------- concept 5

def bars() -> Image.Image:
    """The current icon, for comparison."""
    img = _canvas()
    draw = ImageDraw.Draw(img)
    inset = 0.10
    usable = S * (1 - inset * 2)
    origin = S * inset
    bar_w = usable * 0.205
    gap = usable * 0.065
    left = origin + (usable - (bar_w * 3 + gap * 2)) / 2
    floor = origin + usable * 0.86
    span = usable * 0.72
    for i, (h, c) in enumerate([(1.0, ACCENT), (0.42, DIM), (0.70, MID)]):
        x0 = left + i * (bar_w + gap)
        draw.rounded_rectangle(
            [x0, floor - span * h, x0 + bar_w, floor],
            radius=int(bar_w * 0.13),
            fill=c,
        )
    return img


CONCEPTS = [
    ("1  Monogram", monogram),
    ("2  Pitch", pitch),
    ("3  Ring", ring),
    ("4  Split disc", split_disc),
    ("5  Bars (current)", bars),
]


def contact_sheet(path: Path) -> None:
    big, small = 260, 29
    pad = 28
    label_h = 34
    width = pad + len(CONCEPTS) * (big + pad)
    height = pad + big + 16 + small + 12 + label_h + pad

    sheet = Image.new("RGB", (width, height), (250, 250, 251))
    draw = ImageDraw.Draw(sheet)
    try:
        label_font = ImageFont.truetype(FONT_BLACK, 20)
    except OSError:
        label_font = ImageFont.load_default()

    x = pad
    for name, fn in CONCEPTS:
        art = fn()
        sheet.paste(art.resize((big, big), Image.LANCZOS), (x, pad))
        # 29pt is the Settings row and App Store search result — the size that
        # actually decides whether a concept works.
        sheet.paste(
            art.resize((small, small), Image.LANCZOS),
            (x + (big - small) // 2, pad + big + 16),
        )
        draw.text((x, pad + big + 16 + small + 12), name, font=label_font, fill=(20, 22, 26))
        x += big + pad

    sheet.save(path)
    print(f"wrote {path}")


if __name__ == "__main__":
    ASSETS.mkdir(parents=True, exist_ok=True)
    contact_sheet(ASSETS / "_icon-concepts.png")
