# Korixa Design System — Dark Tech Foundation

```
SOURCE_TASK = KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01-20260904
STATUS = FOUNDATION ONLY — not wired into MaterialApp yet
ZONE_CLASSIFICATION_ENABLED = NO
```

This is the concrete token/component reference for the visual direction
described in `KORIXA_VISUAL_DIRECTION.md`. Read that document first for the
*why*; this one is the *what*.

**Not wired in yet.** `AppTheme.light` / `AppTheme.dark` (the themes
actually used by `MaterialApp` today) are untouched except for one real bug
fix (see §8). `AppTheme.darkTech` builds a complete, valid `ThemeData` from
the tokens below, proving the API works, but nothing in `app.dart`
references it. Migrating real screens is a later task — see
`KORIXA_SCREEN_SPECS.md`.

## 1. Color tokens — `lib/app/theme/app_colors.dart` (`abstract class DarkTech`)

| Token | Value | Notes |
|---|---|---|
| `background` | `#05060A` | app background |
| `surface` | `#0D1017` | base card/surface |
| `surfaceElevated` | `#131722` | one tonal step "closer to the user" |
| `border` | `#242A38` | `BORDER_NEUTRAL` |
| `borderActive` | = `brandBlue` | `BORDER_ACTIVE`; 3.72:1 vs `surface` (WCAG 1.4.11 non-text, ≥3.0:1) |
| `disabledSurface` | `#1A1E29` | disabled controls are exempt from AA contrast (WCAG 1.4.3) |
| `disabledForeground` | = `textMuted` | |
| `overlayScrim` | `#000000` @ 60% alpha | dialogs, bottom sheets, unavailable-route overlay |
| `brandPurple` | `#8B00FF` | 5.93:1 vs white — safe for text-bearing surfaces |
| `brandPurpleBright` | `#B026FF` | 4.60:1 vs white — at the AA floor; prefer for accents/icons, not small body text |
| `brandBlue` | `#315CFF` | 5.12:1 vs white |
| `brandCyan` | `#00D9FF` | 1.70:1 vs white — **decorative/graphic only, never under text**; 11.21:1 vs `surface` as a non-text accent |
| `textPrimary` | `#F7F8FC` | |
| `textSecondary` | `#A7ADBA` | |
| `textMuted` | `#8A90A0` | not in the original proposal; validated at 5.61–6.34:1 across all three surfaces |
| `success` | `#22C55E` | status semantics only, see §6 |
| `warning` | `#F5A623` | |
| `error` | `#FF5C5C` | |
| `difficultyEasy/Moderate/Hard/Extreme` | reuse `brandCyan/Blue/Purple/PurpleBright` | route-difficulty scale, see §7 |

Every value here was checked against `lib/core/utils/color_contrast.dart`,
not copied from the task's example palette verbatim — see the class-level
doc comment in `app_colors.dart` for the two adjustments that were
necessary (`textMuted`, `brandCyan`/dual-gradient split).

The legacy `AppColors` class (`primary`/`secondary`/`zone1-5`/etc.) is
untouched and remains the live theme's source — `DarkTech` is additive,
declared as a separate top-level class in the same file.

## 2. Gradients — `lib/app/theme/app_gradients.dart`

| Token | Stops | Use |
|---|---|---|
| `AppGradients.primary` | purple→blue→cyan, horizontal | decorative only: hero backgrounds, selected-nav indicator, border accents |
| `AppGradients.primaryCta` | purple→blue, horizontal | the only gradient safe under white text — CTA buttons |
| `AppGradients.heroVertical` | purple→blue→cyan, vertical | tall hero surfaces on emotional screens; also the route-image placeholder |
| `AppGradients.imageScrimBottom` | transparent→black@90%, stops `[0.4, 1.0]` | legibility scrim under route-image titles |

See `KORIXA_VISUAL_DIRECTION.md` §4 for why two brand-gradient variants
exist. Never declare a `LinearGradient` literal for these purposes in
screen code — always reference these tokens.

## 3. Spacing & radius

`lib/app/theme/app_spacing.dart` (`AppSpacing`): `xs=4, sm=8, md=12,
base=16, lg=20, xl=24, xxl=32, xxxl=40`.

`lib/app/theme/app_radius.dart` (`AppRadius`): `sm=8, md=12, lg=16, xl=20,
pill=999`, each with a matching pre-built `BorderRadius` constant
(`smRadius`, `mdRadius`, `lgRadius`, `xlRadius`, `pillRadius`).

Before this task, radii were scattered across at least 7 ad hoc values (1,
6, 8, 10, 12, 14, 16 — per KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01) and spacing
had 31 distinct hardcoded sites across 34 files. These two token classes
are the single source of truth going forward; unmigrated screens keep
their current values until migrated (see `KORIXA_SCREEN_SPECS.md`).

## 4. Border / "neon" levels — `lib/app/theme/app_borders.dart`

Three levels, deliberately decreasing in frequency of use:

- `AppBorders.neutral` (`BORDER_NEUTRAL`) — ordinary card/list border. The
  overwhelming majority of borders in the app.
- `AppBorders.active` (`BORDER_ACTIVE`) — selected/focused item. Solid
  brand color, no gradient, no glow (3.72:1 non-text contrast).
- `AppBorders.heroGradientBorder(...)` (`BORDER_HERO`) — rare emotional-
  screen accent using the full brand gradient as a border. At most one
  element per screen.

Built with `Container` (gradient) + `Padding` + `ClipRRect`, deliberately
without a `CustomPainter` — a painter would only be justified by a more
elaborate effect (real blurred glow) than this foundation needs.

## 5. Typography — `lib/app/theme/app_typography.dart`

Font: Inter, bundled as a variable font
(`assets/fonts/inter/Inter-Variable.ttf` +
`Inter-Italic-Variable.ttf`), licensed under SIL OFL 1.1
(`assets/fonts/inter/OFL.txt`, bundled for license traceability). No
runtime download — fully offline-safe. `pubspec.yaml` declares one `fonts:`
entry per weight (400/500/600/700/800 + italic 400), all pointing at the
same variable-font asset; Flutter/Skia resolves the correct instance per
`FontWeight`.

This fixes a real, previously-shipped bug: `AppTheme` set
`fontFamily: 'Inter'` with a `// pending` comment, but `pubspec.yaml`
declared no `fonts:` block and no font file existed in `assets/` — the
entire app was silently rendering in the OS default font. Found in
KORIXA-UIUX-DESIGN-SYSTEM-AUDIT-01.

`AppTypography.textTheme({onSurface, onSurfaceMuted})` builds a full
Material `TextTheme` (display/headline/title/body/label, all explicit —
the app previously had no explicit `TextTheme` at all).

Four metric styles, outside the standard Material scale, all with
`FontFeature.tabularFigures()` so a digit-count change (e.g. `9` → `36`)
never shifts adjacent layout:

| Style | Size/height | Weight | Use |
|---|---|---|---|
| `metricHero` | 56/60 | 800 | the one hero number on a screen (route progress %, session timer) |
| `metricLarge` | 40/44 | 800 | primary HUD metrics (speed, power) |
| `metricMedium` | 28/32 | 700 | secondary HUD metrics (cadence, HR) |
| `metricSmall` | 18/22 | 700 | cumulative footer stats (distance, calories) |

Never use a decorative display font for long body copy — readability wins
over branding for text people actually have to read.

## 6. Status color semantics

| Meaning | Color |
|---|---|
| Connected / available / success | `DarkTech.success` (green) |
| Warning | `DarkTech.warning` (amber) |
| Error / destructive / critical disconnect | `DarkTech.error` (red) |
| Brand / selection / route progress / interactive emphasis | purple / blue / cyan |

Red is **not** the primary brand CTA color anymore (that was the rejected
"Performance Red" direction). Brand hues are never used for the four
status meanings above, and status colors are never used for brand/selection
— mixing the two vocabularies would make e.g. a purple-bordered card
ambiguous between "selected" and "something is wrong."

Per accessibility requirement (§8 below and Section 19 of the source
task), color is never the *only* signal for a state: see `StatusBadge`
(icon + color + label, icon is a required parameter by construction) and
`SelectableCard` (border width changes 1→1.5px in addition to color).

## 7. Route-difficulty scale

Route difficulty is **not** mapped to success/error — that would falsely
imply "hard = bad." Instead it reuses the four already-defined brand hues
as an intensity scale, introducing no new colors:

`difficultyEasy = brandCyan`, `difficultyModerate = brandBlue`,
`difficultyHard = brandPurple`, `difficultyExtreme = brandPurpleBright`.

## 8. Theme — `lib/app/theme/app_theme.dart`

- `AppTheme.light` / `AppTheme.dark` (the active, shipped themes): only
  change is `fontFamily: 'Inter'` → `fontFamily: AppTypography.fontFamily`
  now that Inter is actually bundled (see §5) — a bug fix, zero visual
  intent change beyond "the font that was already supposed to render now
  does."
- `AppTheme.darkTech` (new, **not referenced by `MaterialApp`**): a
  complete `ThemeData` built from every token above — `ColorScheme`,
  `TextTheme`, and component themes for app bar / elevated / outlined /
  text buttons / input decoration / card (with border side) / divider /
  progress indicator / chip / bottom sheet / dialog / snack bar. Exists to
  prove the token set is sufficient to build a real theme, per the task's
  "prove the design-system API works" requirement — not to be switched on
  in this PR.
  - `onSecondary: DarkTech.background` specifically (not white) because
    cyan cannot carry white text — see §1.

## 9. Components — `lib/core/design_system/`

A new, deliberately separate sibling folder to `lib/core/widgets/`
(the legacy shared-widget location, e.g. `AppPrimaryButton`) — kept apart
so "new, not-yet-adopted foundation" is never confused with widgets already
live in shipped screens, and so names don't collide
(`PrimaryGradientButton` vs. the existing `AppPrimaryButton`).

| File | Components |
|---|---|
| `dark_tech_buttons.dart` | `PrimaryGradientButton` (gradient CTA; normal/pressed/disabled/loading states, 52px min height), `SecondaryOutlinedButton`, `GhostButton` |
| `dark_tech_surfaces.dart` | `AppCard` (`surface`), `ElevatedCard` (`surfaceElevated`), `SelectableCard` (border width + color change on selection), `AppTextField` |
| `dark_tech_badges.dart` | `StatusBadge` (icon is a required param), `ComingSoonBadge`, `AvailableBadge`, `ConnectedBadge` |
| `dark_tech_controls.dart` | `SegmentedControl<T>`, `DarkTechBottomNavStyle` (style tokens only — see §10) |
| `dark_tech_metrics.dart` | `RouteProgressBar` (uses `AppGradients.primary` — purely decorative fill, no text on it), `MetricTile` (+ `MetricTier` enum) |
| `dark_tech_route_image.dart` | `DarkTechRouteImage` — see `KORIXA_VISUAL_DIRECTION.md` §5 |
| `dark_tech_dialog.dart` | `showDarkTechDialog`, `showDarkTechBottomSheet` |

### Primary CTA spec

`PrimaryGradientButton`: `AppGradients.primaryCta` background, white label
text (`AppTypography...labelLarge`), 52px minimum height (≥48dp per
Material and WCAG 2.5.5 target-size guidance), full width by default.

- **Normal**: full gradient, opacity 1.0.
- **Pressed**: `InkWell`'s own splash/highlight over the gradient (no
  separate pressed-state gradient needed).
- **Disabled**: gradient replaced entirely by solid
  `DarkTech.disabledSurface` + dimmed label — a "faded gradient" would
  still read as interactive; a flat, brand-less surface communicates
  unavailability without depending on color alone.
- **Loading**: label replaced by a same-size spinner; remains
  non-interactive.

### `MetricTile` and zone color

`MetricTile` accepts an optional `accentColor`, defaulting to
`DarkTech.textPrimary`. This is an extension point for a *future* HR/power
zone coloring feature — the widget itself makes no zone determination and
asserts no physiological claim. See §11.

## 10. Navigation foundation

`DarkTechBottomNavStyle` (`dark_tech_controls.dart`) is a **style-tokens
class only** — `background`, `selectedColor`, `unselectedColor`,
`iconSize`, `selectedLabelStyle`, `unselectedLabelStyle` — matching the
approved Home design's "Inicio / Rutas / Entrenar / Perfil" bottom nav.

It is deliberately **not** a functional navigation widget. `lib/app/router/
app_router.dart` was audited: it is a flat list of `GoRoute`s with no
`ShellRoute` and no bottom-nav widget anywhere (only a comment near line
234 mentioning the possibility). Building a real navigation shell is a
navigation-architecture change, out of scope for this foundation task —
"no fake navigation destinations." A later task that adds the shell should
consume these tokens rather than inventing new ones.

## 11. Zone color caveat

```
ZONE_CLASSIFICATION_ENABLED = NO
```

The existing HR/power zone colors (`AppColors.zone1`–`zone5`) may remain
reserved for future use, but nothing in this foundation displays Z1–Z5 as
physiological truth. `MetricTile.accentColor` is a plain color parameter
with no zone-detection logic behind it — no false physiological claim is
made anywhere in this task's code. Zone display should only ship once
Korixa has a real, user-specific zone engine.

## 12. Functional truthfulness

Nothing in this foundation implements or implies: Korixa Points, a
multiplayer/ranking system, ANT+ support, advanced power zones, community
features, achievements, or a full outdoor mode. `ComingSoonBadge` exists
precisely so a screen can reference a not-yet-real concept truthfully
(neutral tone, `Icons.schedule`, "Coming soon" label) instead of rendering
it as if it already worked. No component in `lib/core/design_system/`
fabricates a balance, ranking, connected-sensor state, or physiological
zone — every such value must be passed in by a real caller with real data,
or the `ComingSoonBadge`/`isAvailable: false` path must be used instead.
