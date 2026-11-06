# Pro Studio UI: Architecture & Design System

Branch: `feat/pro-studio-ui`

## 1. Vision & Core Directive

Transform Ludo Club from a neo-brutalist paper aesthetic into a modern, studio-grade digital board game.
The experience combines:

- **Spatial Glass & Titanium Aesthetics**: Tactile glass surfaces (`backdrop-filter: blur(20px)`), precision hairline borders (`1px solid rgba(255, 255, 255, 0.12)` in dark, `rgba(15, 23, 42, 0.08)` in light), multi-stop ambient shadows.
- **Tournament Board**: Chamfered 20px rounded squircle bezel with ambient back-lighting, clean recessed grid track, and jewel-crafted 3D tokens with specular highlights and energetic turn-pulsing glows.
- **Single-Page Ergonomic Layout**: 100% height-contained (`100dvh`), zero vertical jumping or awkward viewport scrolling during gameplay across mobile, tablet, and desktop.
- **Floating Island Navigation & Controls**: Floating dynamic-island header, docked reaction emoji pill bar with spring physics (`scale(1.25)` on hover, `scale(0.92)` on tap), and unified hero dice card.
- **100% Test Continuity**: Fully adheres to all 135 unit tests and 42 Playwright browser checks (including strict WCAG 2.1 AA accessibility and header geometry).
