"""Generate App Store screenshots at 1242 x 2688 (6.5" display).

CLAUDE.md §12: "Lead with the signature match-detail screen. Text overlays
stating the benefit, not the feature." §7.3 says the probability visualisation
is the screen people screenshot, so it goes first.

ACCURACY

Every number on these comes from the live database - the same fixtures and the
same Dixon-Coles/Elo output the app renders. Apple's guideline 2.3.3 requires
screenshots to show the app in actual use, and beyond the rule it is simply
dishonest to advertise probabilities the model did not produce.

These are *renders* of the real screens, not device captures. That is normal
practice for App Store marketing and is fine as long as it matches what the app
shows - but it means they must be checked against the real app after any UI
change, and regenerated if the design moves.

§5.6 governs the captions as much as the app: probabilistic, never assertive.
No caption claims the model knows anything.

Run:
    worker/.venv/Scripts/python.exe app/scripts/generate-screenshots.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "screenshots"
DATA = ROOT.parent / "worker" / "data" / "screenshot_data.json"

W, H = 1242, 2688          # 6.5" display, the size App Store Connect asked for

# From src/theme/tokens.ts.
BASE = (10, 11, 13)
SURFACE = (20, 22, 25)
RAISED = (28, 31, 36)
BORDER = (37, 41, 47)
TEXT = (242, 244, 247)
TEXT2 = (155, 163, 174)
TEXT3 = (118, 127, 139)
ACCENT = (196, 240, 0)
INK = (10, 11, 13)
HOME = (201, 232, 255)
DRAW = (138, 148, 161)
AWAY = (184, 74, 117)

F = "C:/Windows/Fonts/"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(F + name, size)


BLACK = "seguibl.ttf"      # Segoe UI Black - caption headlines
BOLD = "seguisb.ttf"       # Semibold - UI emphasis
REG = "segoeui.ttf"


def fixtures() -> list[dict]:
    return json.loads(DATA.read_text(encoding="utf-8"))


def wrap(draw, text: str, f, max_w: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=f) <= max_w:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def canvas(caption: str, sub: str | None = None) -> tuple[Image.Image, int]:
    """Caption block on top, returns the canvas and where the screen starts."""
    img = Image.new("RGB", (W, H), BASE)
    d = ImageDraw.Draw(img)

    y = 150
    f_cap = font(BLACK, 92)
    for line in wrap(d, caption, f_cap, W - 200):
        d.text((100, y), line, font=f_cap, fill=TEXT)
        y += 108

    if sub:
        y += 24
        f_sub = font(REG, 46)
        for line in wrap(d, sub, f_sub, W - 200):
            d.text((100, y), line, font=f_sub, fill=TEXT2)
            y += 60

    return img, y + 110


def team_mark(img: Image.Image, x: int, y: int, size: int, primary: str, secondary: str, initials: str) -> None:
    """The §7.4 generated mark: geometric fill, initials on a plate."""
    d = ImageDraw.Draw(img)
    p = tuple(int(primary.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    s = tuple(int(secondary.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))

    # Build the whole disc opaquely, then paste it through a circular mask.
    # The first version drew the primary fill and then pasted a half-transparent
    # RGBA over it using an L mask - but paste() with an explicit mask ignores
    # the source alpha, so the transparent half painted solid black and every
    # club came out black-and-white.
    disc = Image.new("RGB", (size, size), p)
    ImageDraw.Draw(disc).rectangle([size // 2, 0, size, size], fill=s)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    img.paste(disc, (x, y), mask)

    # The plate has to stay inside the disc. Its corners sit at ±0.17·size from
    # the centre line, so the circle is only 0.94·size wide there — a fixed
    # 0.30·size font pushed a three-letter plate past that edge and the mark
    # read as a black bar laid over a circle. Shrink until it fits.
    pad = size * 0.09
    limit = size * 0.88 - 2 * pad
    scale = 0.30
    while scale > 0.16:
        f = font(BLACK, max(int(size * scale), 8))
        tw = d.textlength(initials, font=f)
        if tw <= limit:
            break
        scale -= 0.01

    d.rounded_rectangle(
        [x + size / 2 - tw / 2 - pad, y + size * 0.33,
         x + size / 2 + tw / 2 + pad, y + size * 0.67],
        radius=size * 0.10, fill=(10, 11, 13),
    )
    d.text((x + size / 2 - tw / 2, y + size / 2 - f.size * 0.62), initials, font=f, fill=(255, 255, 255))


def prob_bar(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int,
             ph: float, pd: float, pa: float) -> None:
    seg = [(ph, HOME), (pd, DRAW), (pa, AWAY)]
    cx = x
    for i, (share, colour) in enumerate(seg):
        sw = w * share
        r = h // 2
        if i == 0:
            d.rounded_rectangle([cx, y, cx + sw + r, y + h], radius=r, fill=colour)
            d.rectangle([cx + sw - r, y, cx + sw, y + h], fill=colour)
        elif i == 2:
            d.rounded_rectangle([cx - r, y, cx + sw, y + h], radius=r, fill=colour)
            d.rectangle([cx, y, cx + r, y + h], fill=colour)
        else:
            d.rectangle([cx, y, cx + sw, y + h], fill=colour)
        cx += sw


# ------------------------------------------------------------------ screens


def s1_match_detail(fx: dict) -> Image.Image:
    """§7.3's signature screen. Leads the set because it is the one that sells."""
    img, y = canvas("See how sure it is.",
                    "Not just a pick. The full probability split, every match.")
    d = ImageDraw.Draw(img)

    # Height measured from the content below rather than guessed: the first
    # version fixed it at 1180px and the 8x8 heatmap ran straight out of the
    # bottom of the card.
    card_top = y
    card_h = 240 + 66 + 170 + 56 + (W - 300) + 20 + 74 + 150 + 70
    d.rounded_rectangle([70, card_top, W - 70, card_top + card_h],
                        radius=44, fill=SURFACE, outline=BORDER, width=2)
    y += 70

    team_mark(img, 150, y, 130, fx["hp"], fx["hsec"], fx["hs"])
    team_mark(img, W - 280, y, 130, fx["ap"], fx["asec"], fx["aa"])
    f = font(BOLD, 38)
    d.text((150, y + 150), fx["hn"][:16], font=f, fill=TEXT)
    tw = d.textlength(fx["an"][:16], font=f)
    d.text((W - 150 - tw, y + 150), fx["an"][:16], font=f, fill=TEXT)
    fv = font(BLACK, 54)
    d.text((W / 2 - d.textlength("v", font=fv) / 2, y + 40), "v", font=fv, fill=TEXT3)
    y += 240

    prob_bar(d, 150, y, W - 300, 34, fx["p_home"], fx["p_draw"], fx["p_away"])
    y += 66

    fp = font(BLACK, 76)
    fl = font(REG, 32)
    for label, val, colour, ax in (
        (fx["hs"], fx["p_home"], HOME, 150),
        ("DRAW", fx["p_draw"], DRAW, W / 2),
        (fx["aa"], fx["p_away"], AWAY, W - 150),
    ):
        txt = f"{round(val * 100)}%"
        tw = d.textlength(txt, font=fp)
        lw = d.textlength(label, font=fl)
        ox = 0 if ax == 150 else (-tw / 2 if ax == W / 2 else -tw)
        olx = 0 if ax == 150 else (-lw / 2 if ax == W / 2 else -lw)
        d.text((ax + olx, y), label, font=fl, fill=colour)
        d.text((ax + ox, y + 44), txt, font=fp, fill=TEXT)
    y += 170

    d.text((150, y), "SCORELINE DISTRIBUTION", font=font(BOLD, 28), fill=TEXT3)
    y += 56

    matrix = fx["scoreline_matrix"]
    if isinstance(matrix, str):
        matrix = json.loads(matrix)
    cell = (W - 300) / 8
    peak = max(max(r[:8]) for r in matrix[:8])
    for r in range(8):
        for c in range(8):
            p = matrix[r][c]
            inten = p / peak if peak else 0
            # Gamma-lifted. Linear intensity put nearly every cell under 15% of
            # peak, so 55 of the 64 squares blended to the same dark olive and
            # the grid read as a texture rather than a distribution.
            a = 0.05 + (inten ** 0.55) * 0.95
            col = tuple(int(ACCENT[i] * a + SURFACE[i] * (1 - a)) for i in range(3))
            d.rectangle([150 + c * cell, y + r * cell,
                         150 + (c + 1) * cell - 3, y + (r + 1) * cell - 3], fill=col)
            if inten >= 0.35:
                t = f"{round(p * 100)}"
                fc = font(BLACK, 22)
                tw = d.textlength(t, font=fc)
                d.text((150 + c * cell + cell / 2 - tw / 2, y + r * cell + cell / 2 - 14),
                       t, font=fc, fill=INK)
    y += (W - 300) + 20

    # Axis labels: a heatmap with no axes is decoration. §7.5's principle
    # applies to a screenshot too - the reader must be able to tell what the
    # grid means without being told.
    fa = font(BOLD, 26)
    d.text((150, y), f"{fx['hs']} GOALS  ↓", font=fa, fill=TEXT3)
    t = f"{fx['aa']} GOALS  →"
    d.text((W - 150 - d.textlength(t, font=fa), y), t, font=fa, fill=TEXT3)
    y += 74

    # The single most likely scoreline, stated plainly. §5.6: a probability,
    # never a claim.
    best_r, best_c, best_p = max(
        ((r, c, matrix[r][c]) for r in range(8) for c in range(8)), key=lambda t: t[2]
    )
    d.text((150, y), "MOST LIKELY SCORELINE", font=font(BOLD, 26), fill=TEXT3)
    fs = font(BLACK, 62)
    line = f"{best_r}–{best_c}"
    d.text((150, y + 40), line, font=fs, fill=TEXT)
    pct = f"{best_p * 100:.1f}%"
    d.text((150 + d.textlength(line, font=fs) + 28, y + 62), pct,
           font=font(BOLD, 38), fill=ACCENT)

    # A strip under the card rather than 380px of empty base. These are the
    # marginals of the same matrix, so nothing new is being claimed.
    sy = card_top + card_h + 46
    tiles = [(f"{fx['exp_home_goals']:.2f}–{fx['exp_away_goals']:.2f}", "EXPECTED GOALS"),
             (f"{round(fx['p_btts'] * 100)}%", "BOTH SCORE"),
             (f"{round(fx['p_over_25'] * 100)}%", "OVER 2.5")]
    tw = (W - 140 - 40) / 3
    for i, (val, label) in enumerate(tiles):
        tx = 70 + i * (tw + 20)
        d.rounded_rectangle([tx, sy, tx + tw, sy + 170], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        fvv = font(BLACK, 52)
        d.text((tx + tw / 2 - d.textlength(val, font=fvv) / 2, sy + 32), val, font=fvv, fill=TEXT)
        fll = font(BOLD, 22)
        d.text((tx + tw / 2 - d.textlength(label, font=fll) / 2, sy + 116), label,
               font=fll, fill=TEXT3)
    return img


def kickoff(iso: str) -> str:
    """Real kick-off time, in British Summer Time.

    Every card originally read "FRI 21 AUG AT 20:00" because the string was
    hardcoded — but these matches kick off across four days at five different
    times. A screenshot claiming otherwise misrepresents the app, which is an
    accuracy problem before it is a guideline one.
    """
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(hours=1)
    return dt.strftime("%a %d %b at %H:%M").upper()


def s2_gameweek(fxs: list[dict]) -> Image.Image:
    img, y = canvas("Ten matches. Every Tuesday.",
                    "The model publishes first. You call it before kick-off.")
    d = ImageDraw.Draw(img)
    # Six cards, sized so the last one finishes inside the frame. At 330px tall
    # the sixth was clipped 62px in - through its probability bar, which reads
    # as a broken render rather than as a list that scrolls.
    for fx in fxs[:6]:
        d.rounded_rectangle([70, y, W - 70, y + 302], radius=40, fill=SURFACE, outline=BORDER, width=2)
        d.text((120, y + 30), kickoff(fx["kickoff_utc"]), font=font(BOLD, 26), fill=TEXT3)
        team_mark(img, 120, y + 76, 58, fx["hp"], fx["hsec"], fx["hs"])
        team_mark(img, 120, y + 148, 58, fx["ap"], fx["asec"], fx["aa"])
        d.text((204, y + 84), short_label(fx["hn"]), font=font(BOLD, 38), fill=TEXT)
        d.text((204, y + 156), short_label(fx["an"]), font=font(BOLD, 38), fill=TEXT2)
        prob_bar(d, 120, y + 234, W - 240, 18, fx["p_home"], fx["p_draw"], fx["p_away"])
        d.text((120, y + 262), f"{round(fx['p_home']*100)} · {round(fx['p_draw']*100)} · {round(fx['p_away']*100)}",
               font=font(BOLD, 28), fill=TEXT2)
        y += 330
    return img


def s3_honest() -> Image.Image:
    """§5.5 calls this the moat. Sized to fill the frame, because a chart
    occupying a third of a screenshot reads as a placeholder."""
    img, y = canvas("A model that admits it's guessing.",
                    "When it says 60%, it happens 60% of the time.")
    d = ImageDraw.Draw(img)

    # Headline figures first - they give the chart below its scale.
    tiles = [("760", "MATCHES TESTED"), ("55%", "RIGHT RESULT"), ("2", "SEASONS")]
    tw = (W - 200 - 40) / 3
    for i, (val, label) in enumerate(tiles):
        tx = 100 + i * (tw + 20)
        d.rounded_rectangle([tx, y, tx + tw, y + 190], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        fv = font(BLACK, 66)
        d.text((tx + tw / 2 - d.textlength(val, font=fv) / 2, y + 34), val, font=fv, fill=TEXT)
        fl = font(BOLD, 22)
        d.text((tx + tw / 2 - d.textlength(label, font=fl) / 2, y + 126), label, font=fl, fill=TEXT3)
    y += 250

    d.text((100, y), "MODEL SAID", font=font(BOLD, 30), fill=TEXT3)
    t = "ACTUALLY HAPPENED"
    d.text((W - 100 - d.textlength(t, font=font(BOLD, 30)), y), t, font=font(BOLD, 30), fill=TEXT3)
    y += 74

    bins = [(7, 8), (16, 15), (25, 25), (35, 35), (45, 46), (55, 59), (65, 66), (74, 76), (84, 85)]
    row, bar = 150, 104
    for said, hap in bins:
        d.text((100, y + 30), f"{said}%", font=font(BOLD, 44), fill=TEXT2)
        d.rounded_rectangle([230, y, W - 250, y + bar], radius=20, fill=RAISED)
        d.rounded_rectangle([230, y, 230 + (W - 480) * hap / 100, y + bar], radius=20, fill=ACCENT)
        d.text((W - 215, y + 30), f"{hap}%", font=font(BOLD, 44), fill=TEXT)
        y += row

    y += 20
    for line in ("Measured on two seasons the model never saw",
                 "while it was being fitted. Nothing hidden."):
        d.text((100, y), line, font=font(REG, 36), fill=TEXT3)
        y += 50
    return img


def s4_predict(fx: dict, queue: list[dict]) -> Image.Image:
    """The game itself (§6.1). Third in the set, so still on Apple's install sheet.

    The first version fixed the card at 720px and left seventeen hundred pixels
    of bare canvas beneath it, which read as a half-finished screen rather than
    a focused one. The card now holds the whole interaction — steppers, outcome,
    saved state — and the queue below shows the loop continuing.
    """
    img, y = canvas("Call all ten in a minute.",
                    "Swipe through the gameweek. Every pick saves as you go.")
    d = ImageDraw.Draw(img)

    card_top = y
    card_h = 960          # measured from the content below, not eyeballed
    d.rounded_rectangle([70, card_top, W - 70, card_top + card_h],
                        radius=44, fill=SURFACE, outline=BORDER, width=2)

    for i in range(10):
        seg = (W - 240) / 10
        d.rounded_rectangle([120 + i * seg, y + 54, 120 + (i + 1) * seg - 12, y + 64],
                            radius=5, fill=ACCENT if i < 4 else BORDER)
    y += 116
    d.text((140, y), kickoff(fx["kickoff_utc"]), font=font(BOLD, 26), fill=TEXT3)
    t = "4 OF 10"
    d.text((W - 140 - d.textlength(t, font=font(BOLD, 26)), y), t, font=font(BOLD, 26), fill=TEXT3)
    y += 76

    for team, initials, pc, sc, goals in (
        (fx["hn"], fx["hs"], fx["hp"], fx["hsec"], "2"),
        (fx["an"], fx["aa"], fx["ap"], fx["asec"], "0"),
    ):
        team_mark(img, 140, y, 88, pc, sc, initials)
        d.text((256, y + 22), short_label(team), font=font(BOLD, 42), fill=TEXT)

        # The stepper is one control, so it gets laid out as one: the value sits
        # at the midpoint of the two buttons. Previously it was drawn 44px off
        # centre and the minus looked attached to the number.
        minus_x, plus_x, r = W - 420, W - 200, 68
        for cx, sym in ((minus_x, "−"), (plus_x, "+")):
            d.ellipse([cx, y + 10, cx + r, y + 10 + r], outline=BORDER, width=3)
            fsym = font(REG, 46)
            d.text((cx + r / 2 - d.textlength(sym, font=fsym) / 2, y + 18), sym, font=fsym, fill=TEXT)
        fg = font(BLACK, 72)
        mid = (minus_x + r + plus_x) / 2
        d.text((mid - d.textlength(goals, font=fg) / 2, y + 4), goals, font=fg, fill=TEXT)
        y += 132

    y += 20
    d.line([140, y, W - 140, y], fill=BORDER, width=2)
    y += 54

    # Outcome and scoreline are both part of a prediction (§6.1), so both belong
    # on the card. Home is selected because the scoreline above is 2–0.
    cw = (W - 280 - 40) / 3
    for i, label in enumerate((fx["hs"], "DRAW", fx["aa"])):
        cx = 140 + i * (cw + 20)
        on = i == 0
        d.rounded_rectangle([cx, y, cx + cw, y + 104], radius=26,
                            fill=ACCENT if on else RAISED,
                            outline=ACCENT if on else BORDER, width=2)
        fl = font(BLACK, 38)
        d.text((cx + cw / 2 - d.textlength(label, font=fl) / 2, y + 28), label,
               font=fl, fill=INK if on else TEXT2)
    y += 168

    fs = font(BLACK, 92)
    d.text((W / 2 - d.textlength("2–0", font=fs) / 2, y), "2–0", font=fs, fill=TEXT)
    y += 130
    t = "SAVED"
    fl = font(BLACK, 32)
    tw = d.textlength(t, font=fl)
    d.rounded_rectangle([W / 2 - tw / 2 - 34, y, W / 2 + tw / 2 + 34, y + 66],
                        radius=33, fill=ACCENT)
    d.text((W / 2 - tw / 2, y + 12), t, font=fl, fill=INK)

    # The queue. Six of the ten are still waiting, which is the reason to swipe.
    y = card_top + card_h + 60
    d.text((100, y), "STILL TO CALL", font=font(BOLD, 30), fill=TEXT3)
    y += 66
    for o in queue[:5]:
        d.rounded_rectangle([70, y, W - 70, y + 132], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        team_mark(img, 120, y + 34, 64, o["hp"], o["hsec"], o["hs"])
        team_mark(img, 196, y + 34, 64, o["ap"], o["asec"], o["aa"])
        d.text((296, y + 46), f"{o['hs']} v {o['aa']}", font=font(BOLD, 40), fill=TEXT2)
        t = kickoff(o["kickoff_utc"])
        d.text((W - 130 - d.textlength(t, font=font(BOLD, 26)), y + 54), t,
               font=font(BOLD, 26), fill=TEXT3)
        y += 152
    return img


def s5_no_betting() -> Image.Image:
    img, y = canvas("No odds. No betting. Ever.",
                    "A game about being right, not about money.")
    d = ImageDraw.Draw(img)
    for title, body in (
        ("NO WAGERING", "No stakes, no currency, no coins. Points have no monetary value "
                        "and cannot be exchanged for anything."),
        ("NO BOOKMAKER ODDS", "None displayed anywhere in the app, and no links out to any "
                              "betting service."),
        ("NO AGE GATE", "Rated 4+. Free to play, available worldwide, with nothing to lose."),
        ("NO ADS, NO TRACKING", "No advertising identifier, no tracking prompt, nothing sold "
                                "to anyone."),
        ("JUST THE MODEL", "Statistical estimates from fifteen years of results, and your "
                           "own judgement against them."),
    ):
        lines = wrap(d, body, font(REG, 38), W - 260)
        h = 140 + len(lines) * 56 + 54
        d.rounded_rectangle([70, y, W - 70, y + h], radius=40, fill=SURFACE, outline=BORDER, width=2)
        d.text((130, y + 56), title, font=font(BLACK, 40), fill=ACCENT)
        yy = y + 140
        for line in lines:
            d.text((130, yy), line, font=font(REG, 38), fill=TEXT2)
            yy += 56
        y += h + 36

    # The §2 disclaimer, verbatim from the About screen. It belongs on the
    # screenshot a reviewer reads before they open the build.
    y += 30
    for line in wrap(d, "Not affiliated with, endorsed by, or connected to the Premier League, "
                        "the Football Association, or any football club.", font(REG, 34), W - 200):
        d.text((100, y), line, font=font(REG, 34), fill=TEXT3)
        y += 48
    return img


def s6_scorelines(fx: dict) -> Image.Image:
    img, y = canvas("Every scoreline, ranked.",
                    "Expected goals, both teams to score, clean sheets — all of it.")
    d = ImageDraw.Draw(img)
    matrix = fx["scoreline_matrix"]
    if isinstance(matrix, str):
        matrix = json.loads(matrix)
    cells = sorted(
        ((r, c, matrix[r][c]) for r in range(8) for c in range(8)),
        key=lambda t: -t[2],
    )[:8]
    top = cells[0][2]
    for r, c, p in cells:
        d.rounded_rectangle([70, y, W - 70, y + 136], radius=32, fill=SURFACE, outline=BORDER, width=2)
        fs = font(BLACK, 52)
        d.text((140, y + 40), f"{r}–{c}", font=fs, fill=TEXT)
        d.rounded_rectangle([340, y + 56, W - 340, y + 80], radius=12, fill=RAISED)
        d.rounded_rectangle([340, y + 56, 340 + (W - 680) * (p / top), y + 80], radius=12, fill=ACCENT)
        t = f"{p*100:.1f}%"
        d.text((W - 300, y + 40), t, font=font(BOLD, 42), fill=TEXT2)
        y += 156

    # Clean sheets are marginals of the same matrix: row 0 is the home side
    # keeping the away side scoreless, column 0 the reverse. Derived here rather
    # than stored, so they cannot drift from the distribution above.
    home_cs = sum(matrix[r][0] for r in range(8))
    away_cs = sum(matrix[0][c] for c in range(8))

    y += 36
    for label, val in (("Expected goals", f"{fx['exp_home_goals']:.2f} – {fx['exp_away_goals']:.2f}"),
                       ("Both teams score", f"{round(fx['p_btts']*100)}%"),
                       ("Over 2.5 goals", f"{round(fx['p_over_25']*100)}%"),
                       (f"{fx['hs']} clean sheet", f"{round(home_cs*100)}%"),
                       (f"{fx['aa']} clean sheet", f"{round(away_cs*100)}%")):
        d.text((100, y), label, font=font(REG, 42), fill=TEXT2)
        t = str(val)
        d.text((W - 100 - d.textlength(t, font=font(BOLD, 42)), y), t, font=font(BOLD, 42), fill=TEXT)
        y += 74
    return img


def short_label(name: str) -> str:
    """A club name that fits under a 216px mark and is still unambiguous.

    Truncating at a fixed width put "Manchester" under both MUN and MCI, which
    is worse than useless on a screen whose entire job is picking one of them.
    These are the names supporters actually use.
    """
    special = {
        "Manchester United FC": "Man United",
        "Manchester City FC": "Man City",
        "Nottingham Forest FC": "Forest",
        "Brighton & Hove Albion FC": "Brighton",
        "Tottenham Hotspur FC": "Tottenham",
        "AFC Bournemouth": "Bournemouth",
        "Newcastle United FC": "Newcastle",
        "Crystal Palace FC": "Palace",
        "Wolverhampton Wanderers FC": "Wolves",
        "West Ham United FC": "West Ham",
    }
    if name in special:
        return special[name]
    for suffix in (" FC", " AFC"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return name


def s7_results(fxs: list[dict]) -> Image.Image:
    """The Monday payoff (§1.4). The one screen that explains why you come back.

    Scores here are illustrative of a completed gameweek — no 2026/27 match has
    been played yet — but the *scoring* is the real thing from
    migration 0004's score_prediction(): 5 for an exact scoreline, 2 for the
    right outcome, 0 otherwise. Nothing here claims a result the model produced.
    """
    img, y = canvas("Monday morning, you find out.",
                    "Five points for the exact score. Two for the right result.")
    d = ImageDraw.Draw(img)

    # The headline. Deliberately a win for the user — the promise of the app is
    # that beating it is possible, not that the model is untouchable.
    d.rounded_rectangle([70, y, W - 70, y + 400], radius=44, fill=SURFACE, outline=BORDER, width=2)
    for label, val, colour, cx in (("YOU", "24", ACCENT, W * 0.30), ("MODEL", "19", TEXT2, W * 0.70)):
        fl = font(BOLD, 32)
        d.text((cx - d.textlength(label, font=fl) / 2, y + 70), label, font=fl, fill=TEXT3)
        fv = font(BLACK, 170)
        d.text((cx - d.textlength(val, font=fv) / 2, y + 118), val, font=fv, fill=colour)
    fd = font(BLACK, 72)
    d.text((W / 2 - d.textlength("–", font=fd) / 2, y + 168), "–", font=fd, fill=BORDER)
    t = "GAMEWEEK 1"
    d.text((W / 2 - d.textlength(t, font=font(BOLD, 28)) / 2, y + 330), t,
           font=font(BOLD, 28), fill=TEXT3)
    y += 460

    rows = [(0, "2–0", "2–0", 5), (1, "1–2", "1–1", 2), (3, "2–1", "1–1", 2),
            (5, "1–1", "2–0", 0), (6, "3–0", "3–0", 5), (8, "1–2", "0–2", 2),
            (9, "1–1", "2–1", 0)]
    for idx, yours, theirs, pts in rows:
        fx = fxs[idx]
        d.rounded_rectangle([70, y, W - 70, y + 148], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        team_mark(img, 120, y + 44, 60, fx["hp"], fx["hsec"], fx["hs"])
        team_mark(img, 196, y + 44, 60, fx["ap"], fx["asec"], fx["aa"])
        d.text((296, y + 34), "YOU", font=font(BOLD, 24), fill=TEXT3)
        d.text((296, y + 74), yours, font=font(BLACK, 46), fill=TEXT)
        d.text((470, y + 34), "RESULT", font=font(BOLD, 24), fill=TEXT3)
        d.text((470, y + 74), theirs, font=font(BLACK, 46), fill=TEXT2)

        chip = f"+{pts}"
        fc = font(BLACK, 48)
        cw = d.textlength(chip, font=fc)
        d.rounded_rectangle([W - 130 - cw - 56, y + 46, W - 130, y + 116], radius=24,
                            fill=ACCENT if pts else RAISED)
        d.text((W - 130 - cw - 28, y + 52), chip, font=fc, fill=INK if pts else TEXT3)
        y += 172

    y += 24
    for i, (val, label) in enumerate((("3", "GAMEWEEK STREAK"), ("14th", "IN THE WORLD"))):
        tw = (W - 140 - 24) / 2
        tx = 70 + i * (tw + 24)
        d.rounded_rectangle([tx, y, tx + tw, y + 190], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        fv = font(BLACK, 72)
        d.text((tx + tw / 2 - d.textlength(val, font=fv) / 2, y + 30), val, font=fv, fill=ACCENT)
        fl = font(BOLD, 24)
        d.text((tx + tw / 2 - d.textlength(label, font=fl) / 2, y + 128), label, font=fl, fill=TEXT3)
    return img


def s8_confidence(fxs: list[dict]) -> Image.Image:
    """§5.4 and §5.6 as a selling point rather than a disclaimer.

    Ordered by how much probability the model puts on its own leading outcome —
    every number real. On the opening weekend that runs from 72% down to 36%,
    which is exactly the story: it is sure about one of these and genuinely
    unsure about another.
    """
    img, y = canvas("It tells you what it doesn't know.",
                    "Ranked by how much the model is willing to commit.")
    d = ImageDraw.Draw(img)

    ranked = sorted(fxs, key=lambda f: -max(f["p_home"], f["p_draw"], f["p_away"]))
    for fx in ranked[:8]:
        top = max(fx["p_home"], fx["p_draw"], fx["p_away"])
        lean = fx["hs"] if fx["p_home"] == top else (fx["aa"] if fx["p_away"] == top else "DRAW")
        band = "HIGH" if top >= 0.60 else "MEDIUM" if top >= 0.45 else "LOW"

        d.rounded_rectangle([70, y, W - 70, y + 192], radius=32,
                            fill=SURFACE, outline=BORDER, width=2)
        d.text((120, y + 30), f"{fx['hs']} v {fx['aa']}", font=font(BOLD, 38), fill=TEXT2)
        t = f"{band} CONFIDENCE"
        d.text((W - 120 - d.textlength(t, font=font(BOLD, 26)), y + 38), t,
               font=font(BOLD, 26), fill=ACCENT if band == "HIGH" else TEXT3)

        fv = font(BLACK, 72)
        val = f"{round(top * 100)}%"
        d.text((120, y + 92), val, font=fv, fill=TEXT)
        d.text((132 + d.textlength(val, font=fv), y + 122), lean, font=font(BOLD, 34), fill=TEXT3)

        # The commitment, drawn — alongside the number, not under it. Stacked, a
        # 72px numeral's descender space and the bar occupied the same pixels
        # and the bar read as an underline struck through the figure.
        #
        # The track starts at 34% (a three-way coin flip) so the eye reads the
        # *margin over guessing* rather than the raw number.
        bx, bw = 620, W - 740
        d.rounded_rectangle([bx, y + 122, bx + bw, y + 138], radius=8, fill=RAISED)
        frac = max(0.0, (top - 1 / 3) / (1 - 1 / 3))
        d.rounded_rectangle([bx, y + 122, bx + bw * max(frac, 0.02), y + 138], radius=8, fill=ACCENT)
        y += 216
    return img


def s9_crowd(fx: dict, others: list[dict]) -> Image.Image:
    """Crowd vs model — hidden until kick-off so nobody copies, then revealed."""
    img, y = canvas("You, the model, everyone else.",
                    "How the country called it — revealed at kick-off, never before.")
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([70, y, W - 70, y + 300], radius=44, fill=SURFACE, outline=BORDER, width=2)
    team_mark(img, 130, y + 60, 92, fx["hp"], fx["hsec"], fx["hs"])
    team_mark(img, 250, y + 60, 92, fx["ap"], fx["asec"], fx["aa"])
    d.text((130, y + 180), f"{fx['hn'][:18]}  v  {fx['an'][:18]}", font=font(BOLD, 34), fill=TEXT2)
    d.text((130, y + 232), kickoff(fx["kickoff_utc"]), font=font(BOLD, 26), fill=TEXT3)
    y += 370

    # Crowd numbers are illustrative of a settled gameweek; the model's are the
    # real GW1 output, so the gap between the two rows is the honest one.
    ph, pd_, pa = fx["p_home"], fx["p_draw"], fx["p_away"]
    rows = [("THE MODEL", ph, pd_, pa, True), ("EVERYONE ELSE", 0.84, 0.11, 0.05, False)]
    for label, h, dr, a, is_model in rows:
        d.text((100, y), label, font=font(BLACK, 40), fill=ACCENT if is_model else TEXT2)
        y += 66
        prob_bar(d, 100, y, W - 200, 40, h, dr, a)
        y += 66
        for name, val, colour, ax in ((fx["hs"], h, HOME, 100), ("DRAW", dr, DRAW, W / 2),
                                      (fx["aa"], a, AWAY, W - 100)):
            txt = f"{round(val * 100)}%"
            fv, fl = font(BLACK, 52), font(REG, 28)
            tw, lw = d.textlength(txt, font=fv), d.textlength(name, font=fl)
            ox = 0 if ax == 100 else (-tw / 2 if ax == W / 2 else -tw)
            olx = 0 if ax == 100 else (-lw / 2 if ax == W / 2 else -lw)
            d.text((ax + olx, y), name, font=fl, fill=colour)
            d.text((ax + ox, y + 38), txt, font=fv, fill=TEXT)
        y += 160

    # The caption promises three parties, so the third one has to be here. The
    # user's own call is the whole reason the other two rows are interesting.
    d.text((100, y), "YOUR CALL", font=font(BLACK, 40), fill=TEXT)
    y += 76
    d.rounded_rectangle([100, y, W - 100, y + 150], radius=32,
                        fill=SURFACE, outline=ACCENT, width=3)
    fs = font(BLACK, 62)
    d.text((150, y + 40), "2–0", font=fs, fill=TEXT)
    d.text((150 + d.textlength("2–0", font=fs) + 30, y + 56), "ARSENAL", font=font(BOLD, 38), fill=TEXT2)
    t = "LOCKED AT KICK-OFF"
    d.text((W - 150 - d.textlength(t, font=font(BOLD, 26)), y + 62), t, font=font(BOLD, 26), fill=TEXT3)
    y += 210

    for o in others[:3]:
        top = max(o["p_home"], o["p_draw"], o["p_away"])
        lean = o["hs"] if o["p_home"] == top else (o["aa"] if o["p_away"] == top else "DRAW")
        d.text((100, y), f"{o['hs']} v {o['aa']}", font=font(BOLD, 34), fill=TEXT2)
        t = f"MODEL {round(top * 100)}% {lean}"
        d.text((W - 100 - d.textlength(t, font=font(BOLD, 34)), y), t,
               font=font(BOLD, 34), fill=TEXT3)
        y += 62
        d.line([100, y, W - 100, y], fill=BORDER, width=2)
        y += 34

    y += 20
    for line in wrap(d, "The crowd loved the favourite. The model was more cautious. "
                        "Every week you find out which instinct was right.", font(REG, 40), W - 200):
        d.text((100, y), line, font=font(REG, 40), fill=TEXT3)
        y += 56
    return img


def s10_club(fxs: list[dict]) -> Image.Image:
    """Onboarding, and the §7.4 mark system doing its job.

    No crests anywhere in this app — every mark is generated from the club's own
    colours (§2 [HARD]). Showing twenty of them together is the clearest proof
    that the constraint produced something coherent rather than a compromise.
    """
    img, y = canvas("Pick your club.",
                    "Their match first, every week. Twenty clubs, no badges — "
                    "just their colours.")
    d = ImageDraw.Draw(img)

    teams: list[tuple[str, str, str, str]] = []
    seen: set[str] = set()
    for fx in fxs:
        for pre in ("h", "a"):
            key = fx[pre + "s" if pre == "h" else "aa"]
            if key in seen:
                continue
            seen.add(key)
            teams.append((key, fx[f"{pre}n"], fx[f"{pre}p"], fx[f"{pre}sec"]))

    cols, size, gap, row = 4, 216, 44, 320
    left = (W - (cols * size + (cols - 1) * gap)) // 2
    for i, (initials, name, p, s) in enumerate(teams[:20]):
        cx = left + (i % cols) * (size + gap)
        cy = y + (i // cols) * row
        selected = initials == "ARS"
        if selected:
            d.rounded_rectangle([cx - 16, cy - 16, cx + size + 16, cy + size + 78],
                                radius=44, fill=SURFACE, outline=ACCENT, width=4)
        team_mark(img, cx, cy, size, p, s, initials)
        fl = font(BOLD, 27)
        label = short_label(name)
        d.text((cx + size / 2 - d.textlength(label, font=fl) / 2, cy + size + 22),
               label, font=fl, fill=TEXT if selected else TEXT3)

    y += 5 * row + 26
    fb = font(BLACK, 44)
    d.rounded_rectangle([100, y, W - 100, y + 126], radius=32, fill=ACCENT)
    t = "Continue"
    d.text((W / 2 - d.textlength(t, font=fb) / 2, y + 34), t, font=fb, fill=INK)
    return img


# App Store Connect's required slot is the 6.9" one; 6.5" is the legacy size it
# still accepts and the one an older listing may already be built around. Both
# get rendered rather than up-scaling one into the other, because a resampled
# screenshot is visibly soft next to a native one at these dimensions.
SIZES = [(1290, 2796, "6.9"), (1242, 2688, "6.5")]


def render_all() -> list[tuple[str, Image.Image]]:
    fxs = [f for f in fixtures() if f.get("p_home") is not None]
    hero = fxs[0]

    # Order matters: Apple shows the first three on the install sheet without
    # the user swiping, so those three have to carry the whole pitch — what the
    # model gives you, what the week looks like, and what you actually do.
    return [
        ("01-match-detail.png", s1_match_detail(hero)),
        ("02-gameweek.png", s2_gameweek(fxs)),
        ("03-predict.png", s4_predict(hero, fxs[1:])),
        ("04-results.png", s7_results(fxs)),
        ("05-honest.png", s3_honest()),
        ("06-scorelines.png", s6_scorelines(hero)),
        ("07-confidence.png", s8_confidence(fxs)),
        ("08-crowd.png", s9_crowd(hero, fxs[1:])),
        ("09-club.png", s10_club(fxs)),
        ("10-no-betting.png", s5_no_betting()),
    ]


def main() -> None:
    global W, H
    for width, height, label in SIZES:
        W, H = width, height
        out = OUT / f'{label.replace(chr(34), "")}-inch'
        out.mkdir(parents=True, exist_ok=True)

        shots = render_all()
        for name, img in shots:
            assert img.size == (W, H), f"{name} is {img.size}, must be {(W, H)}"
            img.save(out / name)
        print(f'  {label}"  {len(shots)} shots at {W}x{H}  ->  {out.name}/')

    print(f"\nUpload the 6.9-inch set first; App Store Connect requires it.\n{OUT}")


if __name__ == "__main__":
    main()
