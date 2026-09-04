# Korixa Screen Specs — Implementation Roadmap

```
SOURCE_TASK = KORIXA-UI-DARK-TECH-DESIGN-SYSTEM-01-20260904
STATUS = REGISTRY ONLY — no screen listed below has been redesigned in
         this PR. This document records the official 10-screen roadmap
         for a FOLLOW-UP task; it does not authorize implementing any of
         them here.
```

This is the exact screen registry required by the foundation task. Each
entry names the screen, its intensity level (`KORIXA_VISUAL_DIRECTION.md`
§2), and which foundation tokens/components it is expected to consume once
a later task migrates it — not a visual spec for that migration.

| ID | Screen | Intensity level |
|---|---|---|
| `SCREEN_01` | `WELCOME` | Emotional |
| `SCREEN_02` | `LOGIN` | Emotional |
| `SCREEN_03` | `REGISTER` | Emotional |
| `SCREEN_04` | `HOME` | Emotional (partial — see below) |
| `SCREEN_05` | `RIDE_HUD` | Performance |
| `SCREEN_06` | `ROUTE_CATALOG` | Emotional |
| `SCREEN_07` | `ROUTE_DETAIL` | Emotional |
| `SCREEN_08` | `DEVICES` | Performance |
| `SCREEN_09` | `SESSION_SUMMARY` | Performance |
| `SCREEN_10` | `STATISTICS` | Performance |

## Notes per screen

### SCREEN_01 — WELCOME
Emotional. Expected to use `AppGradients.heroVertical` or full-bleed
photography with `AppGradients.imageScrimBottom`, `PrimaryGradientButton`
for the main CTA, `GhostButton`/`SecondaryOutlinedButton` for secondary
entry points.

### SCREEN_02 — LOGIN
Emotional, lower intensity than Welcome. `AppTextField` for
email/password, `PrimaryGradientButton` for submit, `GhostButton` for
"forgot password."

### SCREEN_03 — REGISTER
Same component set as Login.

### SCREEN_04 — HOME
Emotional in its hero/summary area, but hosts the `DarkTechBottomNavStyle`
tokens (Inicio / Rutas / Entrenar / Perfil) — see
`KORIXA_DESIGN_SYSTEM.md` §10 for why that stays style-only until a real
navigation shell exists. Content cards below the hero should use
`AppCard`/`SelectableCard`, not hero-intensity decoration.

### SCREEN_05 — RIDE_HUD
Performance. No hero gradients, no photography, no `BORDER_HERO`. Primary
consumer of `MetricTile` + the `metricHero/Large/Medium/Small` type scale
and `RouteProgressBar`. Must not display any HR/power zone as
physiological truth (`ZONE_CLASSIFICATION_ENABLED = NO`, see
`KORIXA_DESIGN_SYSTEM.md` §11) unless a real zone engine ships first.

### SCREEN_06 — ROUTE_CATALOG
Emotional. Primary consumer of `DarkTechRouteImage` and the
difficulty-scale tokens (§7 of `KORIXA_DESIGN_SYSTEM.md`) — never
success/error colors for difficulty. `SegmentedControl` for
filter/category switching.

### SCREEN_07 — ROUTE_DETAIL
Emotional. Larger `DarkTechRouteImage` hero, `ComingSoonBadge` /
`AvailableBadge` for content-type truthfulness (video/terrain3d routes
without runnable content behind them must not read as available).

### SCREEN_08 — DEVICES
Performance. `ConnectedBadge`/`StatusBadge` for BLE connection state —
must reflect real connection state only; no fabricated "connected sensor"
ever shown without a real, active BLE connection behind it.

### SCREEN_09 — SESSION_SUMMARY
Performance. `MetricTile` grid for post-session stats; no fabricated
Korixa Points, ranking, or achievement badges — anything not real yet
uses `ComingSoonBadge` or is omitted entirely.

### SCREEN_10 — STATISTICS
Performance. Aggregate `MetricTile`/`metricSmall` usage; same
truthfulness constraint as Session Summary — no fabricated multiplayer
ranking or community leaderboard.

## Explicit non-goals of this document

- This registry does not itself implement, redesign, or restyle any of
  the 10 screens.
- "Minor representative component adoption" already exists elsewhere in
  this PR only insofar as the components above are built and tested in
  isolation — none of the 10 screens' actual source files were modified
  to adopt them as part of this task.
- A future task should reference this file by its exact `SCREEN_0N` IDs
  when scoping per-screen migration work.
