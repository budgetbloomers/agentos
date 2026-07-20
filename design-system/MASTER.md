# Chatterbox Suite — Design System (MASTER)

Global source of truth for the suite's presentation layer (AgentOS command centre + VAS Analytics). Generated with ui-ux-pro-max; page-specific overrides go in `design-system/pages/`. **Presentation only — analytics, calculations, sources and thresholds are owned by the apps' engines and the Dictionary, never by this file.**

## Direction
Dark premium enterprise SaaS (Linear/Datadog/Grafana tier). Swiss-minimal discipline: depth from elevation and light, not decoration; one accent moment per view; data is the hero.

## Color roles (dark theme)
| Role | Token | Value |
|------|-------|-------|
| Canvas | `--bg` | `#050D1C` + blue radial glows (top-right, bottom-left) |
| Surface | `--card` | `#0A1730` + translucent light-blue wash gradient |
| Raised surface | — | `#12294A` (section headers, toasts, tooltips) |
| Stroke system | `--line` | `rgba(148,182,255,.14)` — borders are light, never grey walls |
| Ink / body / muted | `--ink/--body/--muted` | `#EAF1FB / #C6D3E8 / #8296B5` (≥4.5:1 on surfaces) |
| Accent (single) | `--blue` | `#3D9BFF`; primary actions & active nav use gradient `#2E7CF6→#38C6F4` with dark text `#04101F` |
| RAG semantics | `--green/--amber/--red` | `#34D399 / #FBBF24 / #FB7185` + 15% translucent soft variants. Status colours appear ONLY where status has meaning |
| VAS campaign hues | — | Cuddle `#4C9DFF` · Courtesy `#2BD9B0` · VT `#A78BFA` (VAS app only) |

## Typography
Inter (loaded via Google Fonts; CSP-whitelisted). Scale: page title 21/800/-0.55px · card title 14/800 · body 13/1.55 · KPI value 25/800 tabular-nums -0.9px · labels 9.5–11 uppercase +1.7px tracking. Numbers always `tnum`.

## Elevation & shape
Radius 16 (cards/KPIs), 10 (nav items), 20px modals. Shadows: resting `0 6px 24px rgba(2,8,20,.45)`; lifted `0 12px 34px rgba(2,8,20,.55)`. Modals: navy surface + 1px light stroke + backdrop blur 6px.

## Motion
150–250ms, `cubic-bezier(.22,.68,.32,1)`; transform/opacity only (no layout shift). Page enter: fade+6px rise. Modal enter: fade+scale .985. Buttons lift 1px. `prefers-reduced-motion` collapses all to instant.

## Navigation (information architecture)
Role-based groups, in order: **Command** (Executive) · **Sales Ops** · **Quality & Risk** · **People** · **Intelligence** (Visual Brain, Ask) · **VAS Analytics** (dedicated platform, opens its own workspace — data never mixes with command-centre basis) · **Data** · Roadmap. Sticky glass command bar (blur 14, bottom hairline) keeps title, date range, filters and export pinned.

## Components
- **KPI card**: icon chip (soft tint) + name · value (tabular) · delta pill vs previous equal period · sparkline · RAG dot top-right · click = definition card (interp + red-action + owner)
- **Trust bar**: freshness chips per source — always above the fold on Executive
- **Tables**: hairline row separators, hover wash `rgba(148,182,255,.06)`, sortable headers, pills for status
- **Visual Brain**: perpetual-motion canvas graph, hover-spotlight only (no click-through), labels on hover/zoom
- **Ask console**: chat bubbles (user = accent gradient, assistant = raised surface), suggestion chips, status chip
- **Forms**: `#081A31` fields, light stroke, focus ring `0 0 0 3px rgba(37,99,235,.12)` + accent border
- **Empty states**: headline + one sentence + primary action (never a bare "no data")

## Hard rules
1. Engine invariants (weights, ladder, R2A cap) are guarded by hook — presentation may never touch them.
2. No invented metrics: a KPI exists only if its source data exists (churn/ARPC etc. wait for their sources).
3. AgentOS and VAS numbers are never shown side-by-side without their basis label (reconciliation register §9b).
4. PII masked by default in every view; names via `maskName()`.
5. One accent moment per view; RAG colours never decorative.
