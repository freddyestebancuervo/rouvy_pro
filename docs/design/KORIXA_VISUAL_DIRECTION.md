# Korixa Visual Direction

```
VISUAL_DIRECTION = KORIXA_DARK_TECH
STATUS = APPROVED (overrides the "Performance Red" recommendation from
         KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01)
SOURCE_TASK = KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01-20260904
```

## 1. What "Dark Tech" means here

A purple → electric-blue → cyan gradient identity on very dark surfaces.
Premium, athletic, immersive, futuristic — explicitly **not** generic
Material, **not** neon-overload, **not** arcade, **not** glow-on-everything.

The gradient and the near-black surfaces are the two pillars. Everything
else in this document exists to keep those two pillars from being
overused into the things this direction is explicitly rejecting.

## 2. Two visual intensity levels

Korixa is used in two very different moments: browsing/deciding (emotional)
and mid-workout (performance). One visual intensity does not serve both.

### 2.A Emotional screens

Welcome, Login, Register, Route Catalog, Route Detail, and parts of Home.

Allowed: immersive photography, dark photo overlays, the full 3-stop brand
gradient, selective neon-border emphasis (`BORDER_HERO`, see
`KORIXA_DESIGN_SYSTEM.md` §4). These are the screens where the brand can
show off.

### 2.B Performance screens

Ride HUD, Devices, Session Summary, Statistics.

Required: cleaner surfaces, less decoration, high legibility, minimal glow.
A rider glances at these mid-effort, sometimes for a full hour — they must
not cause visual fatigue. No hero gradients, no photography, no
`BORDER_HERO`. Metrics use the tabular-figure type scale
(`AppTypography.metricHero/Large/Medium/Small`) instead of decoration to
create hierarchy.

The same token set (`AppColors.DarkTech`, `AppGradients`, `AppSpacing`,
`AppRadius`) backs both levels — the difference is which tokens a screen
is allowed to reach for, not a second palette.

## 3. Color philosophy

- Near-black tonal surfaces (`background` → `surface` → `surfaceElevated`)
  create depth via lightness steps and hairline borders, not Material
  drop-shadows.
- Purple/blue/cyan is a **brand and interaction** signal (selection, route
  progress, interactive emphasis) — never a status signal. Status
  (connected/warning/error) stays on the conventional green/amber/red
  semantics (`KORIXA_DESIGN_SYSTEM.md` §6). Mixing the two would make a
  purple-bordered card ambiguous ("is this selected, or is something
  wrong?").
- Every token here was measured against `lib/core/utils/color_contrast.dart`
  before being finalized, not copied from the original proposal as-is —
  but a token's own measurement only tells you about the specific pairing
  that was measured; it isn't automatically true for the opposite pairing
  (e.g. this color *as text*, versus this color *as a background under
  text*). Every actual foreground/background pairing this design system
  uses is verified individually — see `KORIXA_DESIGN_SYSTEM.md` §1.1.
  Notable adjustments — see `app_colors.dart`'s `DarkTech` doc comment for
  the measured numbers:
  - `textMuted` was underspecified in the proposal ("a suitable darker
    neutral"); fixed at `#8A90A0`, which clears AA normal-text contrast
    against all three surface tones.
  - `brandCyan` (`#00D9FF`) cannot carry white text as a background
    (1.70:1, far below the 4.5:1 AA minimum) and no reasonably-cyan
    variant fixes this — see §4. As *text* on a dark surface, the same
    color passes with wide margin (10.54–11.93:1) — reused as
    `DarkTech.interactiveText` for exactly that purpose.
  - `brandPurple`/`brandBlue` pass AA as a background under white text
    (5.93:1 / 5.12:1) but fail as a *text* color on the app's dark
    surfaces (3.02–3.42:1 / 3.50:1) — an independent accessibility audit
    (KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01A) caught two real components
    that had used them the wrong way round; both were corrected — see
    `KORIXA_DESIGN_SYSTEM.md` §1.1.

## 4. Gradient usage

**One** official brand gradient asset family, `AppGradients` — never a
gradient declared ad hoc inside a screen. It exists in two variants, for a
measured accessibility reason, not a stylistic one:

- `AppGradients.primary` (3-stop, purple→blue→cyan) — decorative only:
  hero backgrounds, selected-nav indicator, border accents. Never with
  legible text/icon resting on the cyan portion.
- `AppGradients.primaryCta` (2-stop, purple→blue) — the only gradient
  safe for white text anywhere along it. Required for the primary CTA
  button and any other text-bearing gradient surface.

Used sparingly: primary CTA, selected nav/segmented-tab state, hero
accents on emotional screens, and rare `BORDER_HERO` accents (at most one
element per screen). Never duplicated as a raw `LinearGradient(...)`
literal in screen code, and never applied to every card — that is exactly
the "glow everywhere" failure mode this direction is rejecting.

## 5. Image usage

Route/cycling photography always carries a dark bottom-gradient scrim
(`AppGradients.imageScrimBottom`) when a title sits on top of it, and a
16:9 `BoxFit.cover` crop convention so mixed aspect-ratio source images
don't distort card layout. Unavailable routes get an additional full-cover
scrim plus a `ComingSoonBadge` — never disguised as available. See
`lib/core/design_system/dark_tech_route_image.dart` and
`KORIXA_DESIGN_SYSTEM.md` §9 for the component contract.

No production photo library exists yet, and this task does not add one —
the component defines the contract for when one does. No generated mockup
artwork is to be committed as production route data unless explicitly
licensed and approved separately.

## 6. Rider branding

```
KORIXA_RIDER_BRANDING = APPROVED
```

Future imagery should show riders wearing Korixa-branded kit, as a visual
principle. No 3D models or brand-kit assets are part of this foundation
task.

## 7. What this direction is not

- Not neon-overload: brand color is reserved for the handful of uses in
  §4, not applied to every surface.
- Not arcade/gamified: status semantics stay muted and functional (§6 of
  `KORIXA_DESIGN_SYSTEM.md`); no color implies a game-like reward state
  that doesn't exist in the product.
- Not glow-everywhere: three border levels exist (`BORDER_NEUTRAL` /
  `BORDER_ACTIVE` / `BORDER_HERO`) specifically so glow stays the rare
  exception. See `KORIXA_DESIGN_SYSTEM.md` §4.
