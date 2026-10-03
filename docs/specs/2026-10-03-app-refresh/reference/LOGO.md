# StatReel logo concepts (round 4)

StatReel had no logo. Three concepts, each a **simple geometric symbol on a 100×100 grid**, built from the same parts the videos use (bars, axes, rings), so every video can bend, recolour and animate the mark to match its own look. Geometry lives in one module, `src/sv2/statreel-logo.mjs` (`markInner(concept, colorway, t)`). `t` is a 0→1 build-in parameter: bars grow from the axis, the ring sweeps in. The SVG files here and the video end card are drawn from the same code.

Wordmark: "Stat" in the video's ink plus "Reel" in its accent colour, set in Barlow Condensed 800 (OFL). The lockup SVGs embed the font as base64 WOFF2, so they render without the font installed.

## A · Bar Play (chosen for the search video's end card)
Five bars whose ends trace a ▶ play triangle. It reads as a bar chart and as a play button at once, which is the product in one shape: data in, video out.
- **Adapts by:** bar count (4–7), corner radius (sharp for F1, round for Google), one palette colour per bar, bar gap. It can also tilt 90° into a "rising" chart.
- **Motion:** bars grow from the centre axis one after another, and the triangle "assembles". It also works as a loader or progress glyph.
- **Why chosen:** it is the most ownable of the three (no stock film/chart icon look), it holds up at 32 px, and it carries a 4-colour palette naturally.

## B · Reel Axis
A film reel whose six spokes are radial bars of different lengths (a radial bar chart), rimmed by a 300° progress ring. The ring's gap sits on the right, pointing in the play direction.
- **Adapts by:** spoke count = number of entities in the video, spoke colours = entity colours, ring weight. The ring can double as a timeline or progress indicator.
- **Motion:** the ring sweeps on like a progress bar while the spokes extend. It can also spin like a reel.
- **Risk:** an earlier draft with the gap at the top looked like a power button, so the gap was moved. At small sizes the six coloured spokes can still read as a generic "spinner".

## C · Frame Stat
One film frame with sprocket holes and a rising four-bar chart inside.
- **Adapts by:** frame colour = the video's ink, bars = the video's palette, bar count and heights can follow the video's own data (e.g. the final top-4).
- **Motion:** bars rise; the frame can slide like film advancing.
- **Risk:** it is the clearest and most literal of the three, but closest to stock "video analytics" icons, so it is less distinctive.

## Colorways (every concept)
| Colorway | Background | Ink | Palette (bar 1–4) | Accent |
|---|---|---|---|---|
| Google-influenced (search video) | #f3f5fa | #12161a | #4285F4 #EA4335 #FBBC05 #34A853 | #4285F4 |
| F1 Williams style | #0a1f44 | #ffffff | #ffd400 #ffffff #00a3e0 #ffd400 | #ffd400 |
| Africa flags style | #06101f | #f4f8ff | #ffd23f #1fae6a #d4475a #3d7bff | #ffd23f |
| Master (mono) | transparent | #12161a | all ink | ink |

The "Google-influenced" colorway only borrows a 4-colour primary palette for the search video's look. It is not Google's logo and implies no affiliation. For any public or commercial use, check it doesn't read as an endorsement.

## Files
- `X-…-master.svg`: mono mark on a transparent background (master)
- `X-…-mark-{google|williams|africa}.svg`: mark on the colorway background
- `X-…-lockup-master.svg`, `X-…-lockup-{google|williams|africa}.svg`: mark + wordmark (font embedded)
- `sheet.png`: all three concepts with rationale, master and colorways (2400×1500)
- `endcards/endcard-{A|B|C}-{google|williams|africa}.png`: the video's "Powered by StatReel" end card for each concept and colorway (1080×1920)
- `endcards/endcard-{A|B|C}-google.mp4`: 2 s animated end-card clips (build-in) for comparison
