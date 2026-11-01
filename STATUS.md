# AI Village: status

Last updated after the 3D redesign (visual package "Tactile Luminescence"). "Tested" means checked
in a browser against a throwaway hub with the Simulation Lab on, plus `npm run typecheck`,
`npm test` (4 server tests) and `npm run build`.

## Implemented and tested

- **3D characters** (`web/src/engine/creature.ts`): Gemini sphere, Claude pear, ChatGPT astronaut,
  OpenCode box robot, custom pod. All nine states have distinct poses, faces and effects. Phase-offset
  hover/breathing and randomised blink timers per agent. Silhouette test passes in `/?lab=characters`.
- **Village world** (`world.ts`, `terrain.ts`, `pavilions.ts`, `fx.ts`): floating terraced island,
  spire, sparkling pool, channel, bridge, waterfall, conduits, lanterns, bonsai, sky with stars and
  bokeh, four pavilions plus five hex pads. Interior light follows the resident's real state
  (125% working, 60% idle, 15% offline, dark when vacant); status beacons by each door.
- **Live wiring** (`runtime.ts`, `Village3D.tsx`): agents assigned to homes by archetype, states from
  the hub, badges over each home with captions from real events only, click a character, home or
  badge to open the inspector, camera glides to the agent and keeps it in the unobstructed area.
- **HUD**: smoked-glass telemetry bar (counts from the hub, measured WebSocket round trip, handoffs
  today from real `handoff` events), one-click Live / Simulation Lab switch, icon rail, ticker,
  floating drawers, loading overlay while shaders compile.
- **Inspector**: live 3D portrait, OVERVIEW / ACTIVITY / TASKS / CONFIG.
- **Tasks view** backed by the new `GET /api/tasks`.
- **Portraits** of the 3D characters for avatars in the roster, feed, ticker, editor and login.
- **Layouts** checked by viewport emulation: desktop 1280×800, iPad portrait 820×1180 (tab bar,
  bottom-sheet inspector), iPhone 375×812 (tab bar, status deck, compact badges).

## Cosmetics and shop (tested)

- Characters: Sentinel, Alchemist, Conductor and Wisp join the original five; 20 accessories
  (10 new: party hat, halo, top hat, wizard hat, cat ears, flower crown, bow tie, cape, backpack,
  jetpack); 12 emotes with face changes and icons; idle fidgets (off with reduce motion).
- Islands: Nocturne, Sakura, Glacier, Ember, Verdant, each with its own stone, foliage, water or
  lava, sky and particles (petals, snow, embers, fireflies).
- Shop with three deterministic daily deals. Purchase flow tested end to end with the shop
  server in fake-payment mode: checkout, return, signed receipt, hub verification, unlock. Locked
  islands, characters and accessories are refused by the hub. Receipt tests cover forged,
  tampered, wrong-key and other-install receipts.
- **Not tested against real Stripe**: needs your Stripe test key and a deployed shop server
  (see docs/SHOP.md). `shop.config.json` is empty, so this build is browse-only until then.
- Liquid Glass styling across the HUD, drawers, shop, badges and controls.

## Verified in the app (simulation, browser screenshots)

- **Handoff packets** travel the conduits on real `handoff` events: confirmed in the app after
  fixing them (they now float above the path at an even pace, 3 to 6.5 seconds per handoff,
  instead of hugging the ground and crossing in about a second).
- **Kiosk mode**: large clock and status line, Simulation Lab badge, 1.35x badges, Dim and Exit
  controls that fade when idle. Not yet tried from 6 ft on a real iPad.
- **Time of day**: night, dusk, dawn and day all seen. The first setting now applies immediately
  instead of fading in from night.
- **Light theme**: frosted light glass with dark text on the HUD and notifications.
- **Reduce motion**: disables camera easing, drifting particles and idle fidgets; characters still
  animate because their motion carries state.

Fixed in this pass: the island particle shader (petals, snow, embers, fireflies) failed to
compile since the island release, so no particles rendered; all rim-lit materials now share one
compiled shader instead of one per agent colour.

## Publishing readiness

- MIT license, SECURITY.md, public GitHub repository, line-ending rules so the macOS/Linux
  launcher keeps LF.
- Fresh-install test: the files git would publish were exported to an empty folder, then
  `npm install`, typecheck, the server tests, the first-run build, password setup, the default
  agents and secret storage all worked (Windows 11).
- Cross-platform launcher (`npm start`, `start-village.cmd`, `start-village.sh`) and secret storage
  (DPAPI on Windows, AES-256-GCM key file on macOS and Linux). The portable backend is covered by
  tests; **neither has been run on a real Mac or Linux machine yet.**

## Partial

- **Render quality** (`high`, `balanced`, `saver`) is a preference with automatic defaults, and
  frame rate adapts via a performance monitor, but there is no control in Settings yet.
- **Performance**: not measured on a visible screen (the test browser was a hidden pane, which
  throttles rendering). Needs a check on the iPad itself.
- **Bundle size**: about 480 KB gzipped; the 3D code is not yet split from the rest.
- **Two-finger pan on phones** relies on the camera controls' defaults; not tested on a real phone.

## Planned

- Settings control for render quality and time of day preview.
- Idle wandering around homes; ambient details (koi or data motes in the pool).
- `Ctrl+K` command bar and an analytics view (package screens 11A and 12A).
- Visual polish: less regular moss on the front terraces, richer underside rock.
