# Comprehensive UI Audit & Enhancement Roadmap

Tracked on branch `DEV`. Each item is designed to elevate Ludo Club's neo-brutalist board game aesthetics to a high-end, responsive, accessible experience in both light and dark themes.

---

## 1. Dark Mode Contrast, Tokens & Elevation (P0)

- [x] **1.1 Global Dark Mode Token Architecture**
  - Add `--line: #52594e`, `--line-subtle: rgba(244, 241, 231, 0.16)`, `--shadow-color: rgba(0, 0, 0, 0.55)`, and `--paper-muted: #272a25` inside `[data-theme="dark"]`.
  - Replace hardcoded `#191919` borders and box shadows on `.setup-card`, `.lobby-card`, `.dialog`, `.primary`, `.secondary`, `.tab-bar button`, `.privacy-options > button`, `.chat-bubble`, `.reaction-buttons > button`, `.effect-tool`, and `.table-soundboard` with `var(--line)` and `var(--shadow-color)`.

- [x] **1.2 Inverted Disabled Button Contrast in Dark Mode**
  - Fix `:disabled` buttons in dark mode: `:disabled` previously had `background: #e3e3dc` (bright light-gray) which lit up brightly in dark mode.
  - In dark mode, `:disabled` now uses muted dark background (`#282b26`) and low-contrast text (`#757d6e`) with subtle border outline.

- [x] **1.3 Secondary Button Polish in Dark Mode**
  - Ensure `.secondary` has clear border contrast and smooth hover state (`#30332f` background, `var(--line)` border, and high-contrast hover).

- [x] **1.4 Own Chat Bubble Styling in Dark Mode**
  - Replaced glaring sky blue `#d0eaff` in dark mode with a calibrated indigo-slate `#1f3b5c` card, crisp `#3b6290` border, and `#f0f7ff` text.

---

## 2. Settings Dialog Layout & Spacing Bugs (P0)

- [x] **2.1 Text Concatenation Bug (`Capture vibrationOn supported devices`)**
  - Fixed layout of `.settings-row span`, `strong`, and `small`. `strong` and `small` now render as a structured vertical stack with proper typography, hierarchy, and muted subtitle color.

- [x] **2.2 Settings Rows Double-Borders & Uneven Spacing**
  - Eliminated disjointed 45px gaps and double horizontal lines between consecutive settings rows.
  - Normalized `.settings-row` into a unified list with clean divider rules (`border-top: 1px solid var(--line-subtle)` and `border-bottom: 1px solid var(--line-subtle)` on last item).

- [x] **2.3 Toggle Switch Polish**
  - Refined toggle switch track transitions, thumb colors, and dark-theme active state (`#7bb354` track with `#14200c` thumb).

---

## 3. Dialog Geometry, CTA Visibility & Backdrop Blur (P1)

- [x] **3.1 Dialog Field Margin Reduction & Above-the-Fold CTAs**
  - Reduced dialog `.field-label` margins from `25px 0` to `14px 0` (and `.tab-bar` margin to `20px 0`), saving over 70px of vertical space.
  - "CREATE ROOM" and other dialog primary CTAs are now visible above the fold on standard desktop viewports (800px) without scrolling.

- [x] **3.2 Modal Backdrop Frosted Glass Blur**
  - Updated `.dialog::backdrop` from flat `#19191980` to `backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); background: rgba(15, 17, 14, 0.65);` for focal depth over the board.

- [x] **3.3 Dialog Header & Close Button Polish**
  - Upgraded `.icon-button` and `.square-button` with theme-aware `var(--line)` borders, tactile active transforms (`translate(1px, 1px)`), and smooth hover states while preserving exact 46x46 header geometry.

---

## 4. Quick Reactions Bar & Reaction Picker Elevation (P1)

- [x] **4.1 Mobile Tap Target & Grid Clamping**
  - Enhanced `.reaction-buttons > button` and `.effect-tool` with tactile press interaction (`translate(1px, 1px)`), theme-aware shadow tokens, and 4px border radius.

- [x] **4.2 Reaction Countdown Badge Polish**
  - Cleaned up `.reaction-button-time` typography, padding, and tabular numbers.

- [x] **4.3 Reaction Picker Translucency & Styling**
  - Updated `.reaction-picker` (Pop, Burst, Float, Ripple) to frosted glass (`background: color-mix(in srgb, var(--paper) 75%, transparent); backdrop-filter: blur(10px);`) with subtle border so it doesn't obstruct the game board.

---

## 5. Soundboard & In-Game Reactions Overlays (P1)

- [x] **5.1 Soundboard Dropdown & Scroll Container**
  - Elevated `.table-soundboard` with 12px backdrop blur, theme-aware borders, and 6px border radius.
  - Added thin custom scrollbar to `.sound-list` (`scrollbar-width: thin; scrollbar-color: var(--line-subtle) transparent`).

- [x] **5.2 Floating Reaction Animations Polish**
  - Preserved four distinct styles (Pop, Burst, Float, Ripple) with dynamic player color halos, elastic springs, and semi-transparent emojis that float clearly without blocking board squares.

---

## 6. Chat Drawer, Composer & Attachment Menu (P1)

- [x] **6.1 Chat Composer Border & Button Polish**
  - Replaced hardcoded `#191919` borders on `.chat-send` and `.chat-gif-button` with `var(--line)`.
  - Added dark mode border harmonization.

- [x] **6.2 Attachment Menu Frosted Glass**
  - Applied `backdrop-filter: blur(10px)` and theme-aware borders to `.chat-attachment-menu`.

- [x] **6.3 Textarea Focus Ring**
  - Preserved accessible high-contrast focus indicators meeting WCAG 2.1 AA requirements.

---

## 7. Layout, Spacing & Visual Consistency (P2)

- [x] **7.1 Home Screen Hero & Setup Card Consistency**
  - Replaced hardcoded `#191919` borders and box shadows on `.home-stats` and `.home-footer` with `var(--line)` and `var(--shadow-color)`.
  - Normalized subtitle and muted typography to `var(--ink-muted)`.

- [x] **7.2 Room Lobby Polish**
  - Enhanced `.lobby-card` with theme-aware borders and elevation shadows.
  - Cleaned up `.public-room` card styling and seat order button states.

- [x] **7.3 Dead CSS Cleanup**
  - Removed residual `.voice-mode-controls` and `.live-speaker` CSS rules from the retired legacy UDP voice system.
