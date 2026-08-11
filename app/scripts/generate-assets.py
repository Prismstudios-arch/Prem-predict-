"""Generate the app icon and launch assets.

Design brief is CLAUDE.md §7.1: "editorial sports data terminal, not a fantasy
football app... restrained, confident". Explicitly ruled out: gradients, emoji,
glassmorphism, the generic green sports palette.

THE MARK

Three vertical bars — the home / draw / away probability split, which is the
product in one glyph. It is not decoration: the middle bar is shortest because
a draw is nearly always the least likely of the three outcomes, so the shape is
semantically honest as well as asymmetric enough to be memorable.

Only the tallest bar carries the accent. §7.2 allows exactly one accent colour,
used for the model's voice and nothing decorative — here it marks the model's
call, which is the one thing the app exists to state.

WHY IT SURVIVES AT 29pt

App Store search results render the icon tiny, and §12 requires it to work
there. Three chunky bars with generous gaps stay legible when a wordmark or any
fine detail would turn to mush. No thin strokes, no text, no centred detail.

Regenerate with:
    worker/.venv/Scripts/python.exe app/scripts/generate-assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"

# From src/theme/tokens.ts. Kept in sync by hand; there are only three.
BASE = (10, 11, 13)        # #0A0B0D  near-black
ACCENT = (196, 240, 0)     # #C4F000  acid lime

# The two neutral bars were originally #8A94A1 and #4A525C, straight from the
# UI palette. Rendering the legibility sheet showed the darker one dissolving
# into the near-black background at 29pt — the icon lost a third of its shape
# in App Store search results, which is exactly where §12 says it must hold up.
# Both are now lifted well clear of the background. UI text colours are tuned
# for contrast against a surface at body-text size; an icon is a silhouette at
# thumbnail size, and it needs its own values.
MID = (174, 184, 196)      # #AEB8C4
DIM = (111, 122, 135)      # #6F7A87


def draw_mark(canvas: Image.Image, size: int, *, inset: float = 0.0) -> None:
    """Draw the three-bar mark centred on `canvas`.

    `inset` shrinks the mark within the canvas — Android adaptive icons crop a
    circle out of the centre, so the foreground needs padding that the iOS icon
    does not want.

    The mark deliberately fills most of the frame. iOS already crops the corners
    with its superellipse mask, so generous internal margin just makes the glyph
    smaller in the only place it matters — search results.

    There is no baseline. An earlier version had a dim rule under the bars to
    reinforce the chart reading; at 29pt it was invisible and at 1024px it read
    as a stray artefact rather than structure. Three bars alone say "chart"
    perfectly well.
    """
    draw = ImageDraw.Draw(canvas)

    usable = size * (1.0 - inset * 2)
    origin = size * inset

    bar_w = usable * 0.205
    gap = usable * 0.065
    total_w = bar_w * 3 + gap * 2
    left = origin + (usable - total_w) / 2

    floor = origin + usable * 0.86
    span = usable * 0.72

    # Home tallest, draw shortest, away between: the real shape of a 1X2 split.
    bars = [
        (span * 1.00, ACCENT),
        (span * 0.42, DIM),
        (span * 0.70, MID),
    ]

    radius = max(2, int(bar_w * 0.13))

    for i, (height, colour) in enumerate(bars):
        x0 = left + i * (bar_w + gap)
        draw.rounded_rectangle(
            [x0, floor - height, x0 + bar_w, floor],
            radius=radius,
            fill=colour,
        )


def build_icon(path: Path, size: int = 1024) -> None:
    """The App Store icon. Opaque and square — iOS applies its own mask, so
    adding our own rounded corners would double up and look wrong."""
    img = Image.new("RGB", (size, size), BASE)
    draw_mark(img, size, inset=0.10)
    img.save(path)


def build_adaptive_foreground(path: Path, size: int = 1024) -> None:
    """Android crops a circle from the centre, so the mark needs more padding."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(img, size, inset=0.22)
    img.save(path)


def build_splash(path: Path, size: int = 1024) -> None:
    """Transparent mark for the launch screen, which supplies its own base."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_mark(img, size, inset=0.18)
    img.save(path)


def build_favicon(path: Path, size: int = 96) -> None:
    """Tiny. Baseline is dropped — at 96px it becomes noise."""
    img = Image.new("RGB", (size, size), BASE)
    draw_mark(img, size, inset=0.10)
    img.save(path)


def build_legibility_sheet(path: Path) -> None:
    """Renders the icon at the sizes iOS actually uses.

    §12 requires the icon to be "distinctive at thumbnail size in search
    results". This is how you check that without shipping a build — 29pt is the
    Settings row, and it is where over-detailed icons fall apart.
    """
    sizes = [180, 120, 87, 80, 60, 58, 40, 29]
    pad = 24
    width = sum(sizes) + pad * (len(sizes) + 1)
    height = max(sizes) + pad * 2

    sheet = Image.new("RGB", (width, height), (255, 255, 255))
    x = pad
    for s in sizes:
        tile = Image.new("RGB", (1024, 1024), BASE)
        draw_mark(tile, 1024, inset=0.10)
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
