# Pro Studio UI: Architecture & Design System

Branch: `feat/pro-studio-ui`

## 1. Vision & Core Directive

Transform Ludo Club into a professional, studio-grade digital board game engineered specifically for native device ergonomics. The app eliminates all vertical scrolling areas across gameplay and the home dashboard, providing bespoke layouts for both mobile portrait and widescreen desktop landscape.

## 2. Palette: Mud-Black & Warm Stone

The dark theme uses an earthy, warm mud-black carbon palette rather than cold blue/navy tints:

- **Background**: `#11100e` (rich warm mud-black) with subtle radial gradient `radial-gradient(circle at 50% 20%, #1a1916 0%, #11100e 100%)`.
- **Surfaces & Cards**: `#191816` / `#1c1b18` with subtle warm borders `rgba(245, 240, 230, 0.12)`.
- **Elevated Controls**: `#23221f` / `#2b2925`.
- **Text & Ink**: `#f5f2eb` (warm bone white) for high contrast and `#a6a094` (warm stone) for secondary labels.
- **Accents**: Warm golden amber `#f59e0b` and ochre bronze `#d97706`.
- **Classic Board Colors**: Official track colors preserved (Red `#ef4444`, Green `#10b981`, Yellow `#f59e0b`, Blue `#3b82f6`).

## 3. Device-Bespoke Ergonomic Layouts

### Desktop Landscape (`min-width: 900px` & `min-height: 520px`)

- **Game Stage**: Side-by-side cockpit layout.
  - Left/Center: Tournament board maximized to fill available vertical space (`width: min(calc(100dvh - 96px), calc(100dvw - 440px), 740px)`).
  - Right: Dedicated 350px Side Console Deck with Turn Indicator Hero card, 3D Dice roller, Hold to Speak button, docked reaction emoji bar, and table soundboard.
  - Zero vertical scroll: `document.documentElement.scrollHeight <= window.innerHeight`.
- **Home Dashboard**: Two-column Game Hub cockpit.
  - Left: Brand kicker, title, play mode action cards ("PLAY WITH FRIENDS", "PLAY OFFLINE"), and quick links.
  - Right: Floating preview board and docked 3-card live stats bento bar.

### Mobile Portrait (`max-width: 899px`)

- **Game Stage**: Single-page mobile app.
  - Top: Header with back navigation and audio controls (46×46 geometry).
  - Center: Board clamped to `min(calc(100dvh - 210px), calc(100dvw - 20px), 520px)`.
  - Bottom Dock: 50/50 split for Roll Dice and Mic button (satisfying equal bounding box requirements) with docked 6-emoji reaction bar.
- **Home Dashboard**:
  - Compact title, 2 full-width play mode cards, 140px preview board, and live stats ticker.
  - Zero vertical scrolling across screen sizes.

## 4. Test Verification

- **Unit Tests**: 135/135 passed (`npm test`).
- **Browser E2E**: 42/42 passed (`npm run test:browser -- --project=chromium`).
- **WCAG 2.1 AA**: 100% compliant in both light and dark themes.
- **Lint**: 0 errors (`npm run lint`).
