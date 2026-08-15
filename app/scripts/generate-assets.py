"""Generate the app icon and launch assets.

Design brief is CLAUDE.md §7.1: "editorial sports data terminal, not a fantasy
football app... restrained, confident". Ruled out: gradients, emoji,
glassmorphism, the generic green sports palette.

THE MARK

A geometric R, drawn as paths rather than set in a typeface.

The previous icon was three bars — an honest rendering of the probability
split, but it read as a generic analytics app. Nothing about it said football,
and on a home screen beside other finance and chart apps it disappeared.

A letterform is what most consumer apps land on, because the icon and the name
reinforce each other and a single glyph survives being shrunk to 29pt when any
amount of detail does not. Drawing it by hand rather than rendering Arial Black
keeps it distinctive: the bowl is squared off and the leg is cut at an angle,
so it reads as a designed mark rather than a font sample.

WHY IT SURVIVES AT 29pt

App Store search results render the icon tiny and §12 requires it to work
there. The stroke weight is ~19% of the icon width, well above the point where
antialiasing turns a shape to mush, and there is exactly one form — no
secondary detail to lose.

Regenerate with:
    worker/.venv/Scripts/python.exe app/scripts/generate-assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"

BASE = (10, 11, 13)        # #0A0B0D  near-black
ACCENT = (196, 240, 0)     # #C4F000  acid lime


def draw_r(canvas: Image.Image, size: int, *, inset: float, colour=ACCENT) -> None:
    """Draw a geometric R centred on the canvas.

    Built from rectangles and a polygon rather than a font so the proportions
    are ours: a tall square bowl, a heavy stem, and a leg cut on the diagonal.
    """
    draw = ImageDraw.Draw(canvas)

    box = size * (1.0 - inset * 2)
    left = size * inset
    top = size * inset

    stem_w = box * 0.200          # stroke weight, tuned for 29pt legibility
    bowl_h = box * 0.560          # where the bowl closes and the leg begins
    bowl_r = box * 0.270          # outer radius of the bowl's right edge

    # --- stem: the full-height vertical -----------------------------------
    draw.rectangle([left, top, left + stem_w, top + box], fill=colour)

    # --- bowl: a squared arch, drawn as an outer block minus an inner one --
    bowl_right = left + box * 0.80
    draw.rounded_rectangle(
        [left, top, bowl_right, top + bowl_h],
        radius=bowl_r,
        fill=colour,
        corners=(False, True, True, False),
    )
    # Counter (the hole). Punched in the background colour so the shape stays
    # a single flat form with no seams.
    counter_inset = stem_w
    c_left = left + counter_inset
    c_top = top + counter_inset
    c_right = bowl_right - counter_inset
    c_bottom = top + bowl_h - counter_inset
    # Pillow rejects a radius larger than half the shorter side, and the first
    # proportions produced a counter thinner than its own corner radius.
    c_radius = max(2, min(bowl_r - counter_inset, (c_bottom - c_top) / 2 - 1))
    draw.rounded_rectangle(
        [c_left, c_top, c_right, c_bottom],
        radius=c_radius,
        fill=BASE,
        corners=(False, True, True, False),
    )

    # --- leg: cut on the diagonal from the bowl's join to the baseline -----
    join_x = left + box * 0.42
    draw.polygon(
        [
            (join_x, top + bowl_h - stem_w * 0.9),
            (join_x + stem_w, top + bowl_h - stem_w * 0.9),
            (left + box, top + box),
            (left + box - stem_w, top + box),
        ],
        fill=colour,
    )


def build_icon(path: Path, size: int = 1024) -> None:
    """The App Store icon. Opaque and square — iOS applies its own mask, so
    adding rounded corners here would double up and look wrong."""
    img = Image.new("RGB", (size, size), BASE)
    draw_r(img, size, inset=0.26)
    img.save(path)


def build_adaptive_foreground(path: Path, size: int = 1024) -> None:
    """Android crops a circle from the centre, so the mark needs more padding."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # The counter is punched in BASE, so this variant needs the plate behind it.
    plate = Image.new("RGB", (size, size), BASE)
    draw_r(plate, size, inset=0.34)
    img.paste(plate, (0, 0))
    img.save(path)


def build_splash(path: Path, size: int = 1024) -> None:
    img = Image.new("RGB", (size, size), BASE)
    draw_r(img, size, inset=0.32)
    img.save(path)


def build_favicon(path: Path, size: int = 96) -> None:
    img = Image.new("RGB", (size, size), BASE)
    draw_r(img, size, inset=0.24)
    img.save(path)


def build_legibility_sheet(path: Path) -> None:
    """Renders the icon at the sizes iOS actually uses.

    §12 requires the icon to be "distinctive at thumbnail size in search
    results". 29pt is the Settings row, and it is where over-detailed icons
    fall apart — this is how you check without shipping a build.
    """
    sizes = [260, 180, 120, 87, 80, 60, 58, 40, 29]
    pad = 26
    width = pad + sum(sizes) + pad * len(sizes)
    height = max(sizes) + pad * 2

    sheet = Image.new("RGB", (width, height), (250, 250, 251))
    x = pad
    for s in sizes:
        tile = Image.new("RGB", (1024, 1024), BASE)
        draw_r(tile, 1024, inset=0.26)
        sheet.paste(tile.resize((s, s), Image.LANCZOS), (x, (height - s) // 2))
        x += s + pad
    sheet.save(path)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    build_icon(ASSETS / "icon.png")
    build_adaptive_foreground(ASSETS / "adaptive-icon.png")
    build_splash(ASSETS / "splash-icon.png")
    build_favicon(ASSETS / "favicon.png")
    build_legibility_sheet(ASSETS / "_icon-legibility-check.png")

    for f in sorted(ASSETS.glob("*.png")):
        with Image.open(f) as im:
            print(f"  {f.name:32s} {im.size[0]:4d}x{im.size[1]:<4d} {im.mode}")


if __name__ == "__main__":
    main()
