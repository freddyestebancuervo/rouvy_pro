# Claude — Visual UI Hardening (KORIXA-VISUAL-UI-HARDENING-PARALLEL-20260909)

```
BASE_SHA = f0f371f31c7ae8f6a93193a2102d937f9f44fd4f
BRANCH = feat/visual-ui-hardening-20260909
ROLE = CLAUDE_VISUAL_AGENT (visual presentation only — parallel to OpenCode's
       Device Adapter Phase A / toolchain work, explicitly independent)
PROJECT_STATUS_CONSOLIDATION = DEFERRED
```

This document is Claude's own evidence trail for this task, kept separate from
`PROJECT_STATUS.md` per the explicit documentation-concurrency rule for this
task (OpenCode and Claude must not write to that shared file simultaneously).

## 1. Scope discipline

Confirmed before and after every edit — zero touches to:
`BleDataSource`/`BleDataSourceImpl`/`DeviceRepository*`, `TelemetrySnapshot`,
`TelemetryAggregator`, `RideSessionController`, any BLE/telemetry parser, any
adapter/registry/resolver, `lib/features/device_connection/**`, `backend/**`,
`firebase/**`, auth domain/data architecture,
`lib/features/settings/presentation/pages/settings_page.dart` (owned by PR
#133), `PROJECT_STATUS.md`, and every toolchain file
(`.gitattributes`, `.github/workflows/ci.yml`, `.github/workflows/ios-build.yml`,
`.github/workflows/ios-simulator-smoke.yml`).

```
DEVICE_ADAPTER_FILES_CHANGED = 0
DEVICE_API_DEPENDENCIES_INTRODUCED = 0
DEVICE_MOCKS_CREATED = 0
TOOLCHAIN_FILES_CHANGED = 0
BACKEND_FILES_CHANGED = 0
PROJECT_STATUS_CHANGED = 0
SETTINGS_PAGE_RADIOGROUP_FILE_CHANGED = 0
```

No finding in this audit required deferral for Device Adapter/BLE/telemetry
contract reasons — every issue found was a pure styling/layout defect fixable
with data and widgets that already exist in the repo.
`BLOCKED_BY_DEVICE_ADAPTER_PHASE_A` = none.
`BLOCKED_BY_TOOLCHAIN_ALIGNMENT` = none (the previous Flutter-3.32-vs-3.44
mismatch that blocked PR #133 was already resolved by PR #135/#136 on this
`origin/main` before this task started — `flutter analyze --fatal-infos`
ran clean with the required `Flutter 3.44.7`/`Dart 3.12.2` toolchain
throughout this task, no shim introduced).

## 2. Visual audit (read-only, via a dedicated Explore pass over the 15
primary presentation files across Home/Routes Catalog/Workouts/
Training/Profile)

Full raw findings are in the audit sub-agent's report (not duplicated here in
full); summarized and prioritized below. `AppSpacing`/`AppRadius`/
`AppTypography`/`AppColors`/`AppBorders` (in `lib/app/theme/`) and
`AsyncValueView`/`EmptyStateView`/`ErrorStateView`/`AppPrimaryButton` (in
`lib/core/widgets/`) already exist and were confirmed as the correct reuse
targets — no new design system was introduced.

```
VISUAL_ISSUES_FOUND = ~35 (across 15 files)
RESPONSIVE_ISSUES_FOUND = 4 (unguarded Row-of-Columns stat groups x2,
    fixed 2-column grid vs. LayoutBuilder-driven grid inconsistency,
    no max-width cap on several list/detail screens)
ACCESSIBILITY_VISUAL_ISSUES_FOUND = 2 (archived-workout icon with no
    label/semantics; low-contrast-only interval differentiation in
    workout_detail_page — both left as-is, see §4)
INCONSISTENCIES_FOUND = several (raw magic-number spacing/radii in every
    file audited; hardcoded, unaudited `Colors.*` difficulty scale
    duplicating the purpose-built, contrast-checked `DarkTech.difficulty*`
    tokens; CTA widget/style inconsistency between screens; inconsistent
    error/empty-state handling across otherwise-identical list/detail
    screens)
```

## 3. Prioritization and what was actually implemented

Per the task's explicit rule ("Do not spend large effort on P3 while
meaningful P1/P2 work remains", "avoid an oversized abstraction layer merely
for visual cleanup"), this pass implemented only P1s (serious
responsive/consistency problems) that were safely fixable with existing
components, plus one very small P2 nudge. The repo-wide magic-number sprawl
(EdgeInsets/BorderRadius/TextStyle not sourced from `AppSpacing`/`AppRadius`/
`AppTypography` across ~15 files) and the hardcoded difficulty-color scale
were deliberately **not** touched in this pass — see §4/§5 for why.

| # | File(s) | Finding | Severity | Fix |
|---|---|---|---|---|
| 1 | `home_page.dart`, `profile_page.dart`, `ride_history_page.dart`, `statistics_page.dart` | Hand-rolled `Center(child: Text(...))` error states with **no retry action** (dead end for the user), inconsistent with `routes_catalog_page.dart`/`workouts_list_page.dart` | P1 | Swapped to the existing `ErrorStateView(message:, onRetry:)` widget, wiring `onRetry` to `ref.invalidate(...)` on the underlying source provider (`authStateProvider` / `rideSessionsProvider`) — a pure presentation-layer callback, no new provider/state logic |
| 2 | `ride_history_page.dart`, `statistics_page.dart` | Empty state was a plain gray `Text`, no icon, inconsistent with the catalog/workouts empty states | P1 | Swapped to the existing `EmptyStateView(message:, icon:)` widget |
| 3 | `training_hud_page.dart` + `metric_display.dart` | The exact, already-documented defect `AppTypography.metricHero/Large/Medium/Small` was built to fix ("today the 4 HUD gauges have identical visual weight") was still unfixed — all 4 metrics used the same `textTheme.displaySmall` | P1 | Added an optional `valueStyle` param to `MetricDisplay` (falls back to the old `displaySmall` if omitted, so no other/future caller breaks); wired speed/power to `AppTypography.metricLarge` and cadence/heart-rate to `AppTypography.metricMedium` in `training_hud_page.dart`, matching the tokens' own documented intent |
| 4 | `session_summary_page.dart` (`_SummaryStat`), `statistics_page.dart` (`_TotalStat`) | `Row(mainAxisAlignment: spaceAround, children: [Column, Column, Column])` with no `Expanded`/`Flexible` — real overflow risk on a narrow phone or a longer localized label | P1 | Wrapped each stat in `Expanded`; added `textAlign: center`, `maxLines: 1`, `overflow: TextOverflow.ellipsis` inside the stat widgets themselves so long values/labels truncate gracefully instead of overflowing |
| 5 | `route_detail_page.dart` | The primary "start training" `FilledButton.icon` was not full-width, while the mutually-exclusive "coming soon" branch in the exact same visual slot used a full-width `Container` — inconsistent CTA prominence between two states of the same button area | P1 | Wrapped the button in `SizedBox(width: double.infinity, child: ...)` to match |
| 6 | `profile_page.dart` | `TextButton(onPressed: () {}, ...)` — a visually-normal, tappable "Cambiar foto" button that silently does nothing (feature not yet implemented) | P2 (UX-clarity, not a visual defect per se, but a real dead-end trap) | Changed to `onPressed: null` so the button renders visibly disabled — honest about the feature not being available yet, with zero functional change (it already did nothing) |

## 4. Deliberately NOT touched, and why

- **`AsyncValueView`-style refactor of `ride_history_page.dart`/
  `statistics_page.dart`/`profile_page.dart`/`home_page.dart`'s overall
  `.when()` structure**: `async_value_view.dart`'s own doc comment records an
  explicit prior decision — *"Las pantallas YA construidas antes de este
  widget no se tocan (no vale la pena el riesgo de refactorizar 6 pantallas
  que ya funcionan solo por consistencia)"*. Respecting that, this pass only
  swapped the leaf error/empty **widgets** (`ErrorStateView`/`EmptyStateView`)
  in place, inside each screen's own existing `.when()`/conditional
  structure — not the surrounding control flow. Same visual outcome, far
  smaller and safer diff.
- **`ride_history_page.dart`'s hardcoded Spanish month abbreviations**
  (`_formatDate`, P3, real localization-expansion risk but not P1): fixing it
  properly means introducing `intl`'s `DateFormat` with the current locale —
  a genuinely new pattern with **zero existing precedent** anywhere in this
  codebase (confirmed via repo-wide grep) and an unverified runtime risk
  (locale-data initialization for non-`es` locales was not proven safe
  without a live device/simulator check). Left as-is and flagged here rather
  than risk an unverified new failure mode for a P3 finding.
- **Hardcoded, unaudited `Colors.green/orange/deepOrange` difficulty scale**
  in `route_card.dart`/`route_detail_page.dart` (P1/P2, real inconsistency
  vs. the purpose-built `DarkTech.difficultyEasy/Moderate/Hard/Extreme`
  tokens): **not applied**, because `DarkTech` is explicitly documented as
  "a foundation only, not yet wired to `MaterialApp`" — the rest of this app
  (including every screen in this task's scope) runs on the standard
  `Theme.of(context).colorScheme`, not `DarkTech`. Introducing one
  `DarkTech`-sourced color into an otherwise fully-Material-themed screen
  would be a visually inconsistent one-off, not a fix, until an explicit
  decision is made about `DarkTech`'s app-wide rollout. Recommended as a
  candidate for a dedicated follow-up task once that decision exists.
- **Repo-wide magic-number spacing/radius/typography sweep**: real and
  systemic (every one of the 15 audited files uses raw `EdgeInsets`/
  `BorderRadius.circular(n)`/`TextStyle(...)` instead of `AppSpacing`/
  `AppRadius`/`AppTypography.textTheme`), but touching ~15 files purely for
  constant-substitution is exactly the "oversized abstraction/cleanup effort"
  this task said to avoid while P1 work remained. Left as a documented,
  systemic P2/P3 finding for a dedicated, explicitly-scoped follow-up.
- **Accessibility findings** (archived-workout icon with no label;
  low-contrast-only interval bar differentiation in `workout_detail_page`):
  both P3, cosmetic-adjacent, left untouched this pass per the same
  effort-prioritization rule.

## 5. Responsive check

Representative widths conceptually reasoned through against the actual fix
mechanics (Expanded/maxLines/ellipsis is a mechanically-guaranteed-safe
Flutter idiom for the Row-of-Columns overflow class fixed in §3 — no text
length or locale can make an `Expanded` child exceed its allotted share, and
`maxLines:1` + `TextOverflow.ellipsis` caps the rest): 320/360/390/430/768/
1024/1440 px all covered by construction for the two rows fixed. No new
horizontal-scroll, fixed-width, or unconstrained-`Row` code was introduced by
any change in this pass. No change in this pass affects desktop/web
max-width behavior (that systemic gap — several screens have no
`ConstrainedBox` cap at all — was catalogued in the audit but not fixed here,
per the same effort-prioritization rule).

## 6. Home visual polish — placeholder classification (Phase 5)

- `Text(l10n.startTrainingAction)` FAB, the profile/logout `AppBar` actions,
  and the primary user-name header: **KEEP** — real, working functionality,
  no changes needed beyond what's covered above.
- `'Plan de entrenamiento IA — próximamente en M8/M9.'` hardcoded-Spanish
  "coming soon" line: **CLARIFY** (it already reads clearly as a future
  placeholder to a Spanish-speaking user) — the underlying localization gap
  (this string bypasses `l10n` entirely) was noted but not fixed in this
  pass, since adding a new key means touching the ARB files + regenerating
  l10n output, which risks brushing against the toolchain-concurrency
  boundary for no urgent gain on a "próximamente" line.
- No placeholder in Home was classified `REMOVE` or
  `BLOCKED_BY_FUTURE_FEATURE` — nothing here depends on Device Adapter
  Phase A.

## 7. Tests

```
VISUAL_WIDGET_TESTS = PASS (3/3 new — test/features/training/presentation/widgets/metric_display_test.dart)
HOME_TESTS = no dedicated pre-existing suite; covered indirectly by test/navigation/demo_navigation_test.dart (still PASS)
OTHER_PRESENTATION_TESTS = no regression in any pre-existing widget/page test (see FULL_FLUTTER_TESTS)
FULL_FLUTTER_TESTS = PASS — 541 passed / 5 skipped / 0 failed (538 pre-existing + 3 new, 0 removed, 0 newly failing)
ANALYZE = PASS — flutter analyze --fatal-infos: No issues found! (Flutter 3.44.7 stable / Dart 3.12.2, the exact required toolchain)
DEVICE_MOCKS_CREATED = 0
```

`KNOWN_EXTERNAL_TOOLCHAIN_BLOCKER` = NO (analyze is fully clean with the
correct 3.44.7 toolchain; the earlier 3.32.0-vs-3.44.x mismatch that
previously blocked PR #133 was already resolved upstream on this
`origin/main` before this task began).

## 8. Files changed

```
lib/features/home/presentation/pages/home_page.dart
lib/features/profile/presentation/pages/profile_page.dart
lib/features/routes_catalog/presentation/pages/route_detail_page.dart
lib/features/training/presentation/pages/ride_history_page.dart
lib/features/training/presentation/pages/session_summary_page.dart
lib/features/training/presentation/pages/statistics_page.dart
lib/features/training/presentation/pages/training_hud_page.dart
lib/features/training/presentation/widgets/metric_display.dart
test/features/training/presentation/widgets/metric_display_test.dart (new)
```

9 files total, 0 unexpected. No commit/push/PR performed as of this writing —
see the task's final report for that status at time of hand-off.
