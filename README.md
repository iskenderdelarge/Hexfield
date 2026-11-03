# Hexfield — 4X Tactical Simulator

Run with `npm run dev`; build with `npm run build`.

## Publishing on GitHub Pages
The GitHub Actions workflow builds and publishes the game when `main` or `arena/427fde5c-hexfield` is pushed. Both branches publish to the same live site. In the repository's **Settings → Pages**, set **Build and deployment → Source** to **GitHub Actions**. GitHub Pages must be available for the repository's visibility and account plan; on GitHub Free, the repository must be public. If the first workflow ran before Pages was enabled, re-run it from the **Actions** tab. The website is public even when Pages is enabled for a private repository.

The workflow builds for the project URL `/Hexfield/`. No generated files need to be committed. For a manual static deployment, run `npm run build` and upload the `dist` folder instead.

## Simulation (combat + AI)
- Combat is **simultaneous only**. All attacks resolve before movement: a targeted unit cannot retreat, mutual attacks kill both, and two units targeting one tile cancel. A unit may move onto a tile vacated by an ally in the same round; movement chains resolve in dependency order.
- AI: three-move selective lookahead for both sides, memoized rollouts, seeded self-play diversity. Settlers value founding cities; armies value capitals and city pressure.
- Runs use a worker pool (max 8) or **Low power** (1 worker). Custom rules are copied to every worker. Editing geometry invalidates learned per-unit weights.
- Bundled studies and saved studies from before the new-city production timing change are labelled historical; old data is normalized so reports never crash. Existing learned per-unit weights are retained.

## 4X Play
- Select Play. Each player starts with **one Settler** and no cities. Settlers move to any empty tile within two rings (18 tiles).
- Select a Settler → **Special Actions → Found a City**. Orders resolve when the round ends. The settler is consumed. Your first city is your **Capital** and claims its centre + 6 adjacent tiles.
- New cities start with **0 production** and begin earning **2 production/turn** on the following turn; every unit costs **5**. Each unit type keeps its own paused progress. Switching back resumes that progress. Excess production from a completed unit becomes city-wide overflow, applied once to the selected project on the next turn. Cities complete at most one unit per turn. Units spawn on the city centre or a free territory tile; a blocked spawn retains its production.
- Cities are captured only by the existing six-hex encirclement rule. Enemy movement and advancing attacks cannot enter or pass through an enemy city centre. Brown ranged attacks can still attack a garrison without entering.
- Victory: control **ceil(2/3 × players)** capitals. A player with no units and no cities is eliminated. Simulation measurements cap at **100 rounds**, training games at **50 rounds**, then adjudicate by capitals, cities and material. Human matches are not capped by these simulation limits.
- Maps: Duel 22×16 (no wrap), Clash 32×24, Battle 40×30, War 50×38 (all west–east wrapping). Player count is independent of map size.
- Pan with click-drag, zoom with the toolbar or mouse wheel, centre on your capital with the compass button. Wrapping maps render only visible sections around the seam; units, projectiles and order lines use the nearest image across it. To keep rendering bounded on unusually wide or short screens, zoom-out is limited to at most three world widths at once. Duel does not wrap. City and special-action menus overlay the bottom-right of the map. End turn, enemy reach and fullscreen are in the map's top bar.
- Orders deselect the unit automatically; reselect it to change the order. Assigned orders draw thin green/red/yellow lines.

## Live online
Host: choose **2-10 players**, select Online P2P, create a room, and share the invitation. Each joining browser gets its own civilization seat; the host is player 1. The host validates ownership of unit orders and production choices, waits for every active seat to lock orders, and broadcasts the resolved world. Chunked binary WebRTC messages support large maps and snapshots. All active seats must be connected before play; disconnected seats are reserved for rejoining from the same browser session. Keep the host tab open. This remains peer-hosted, not a persistent dedicated server.

Uses PeerJS public signalling/WebRTC; strict NATs may need TURN. Deploy on public HTTPS (a localhost link is not shareable). Optional build variables: `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.

## Checks
Run `npx tsc --noEmit`, `npx tsx scripts/test-engine.ts`, `npx tsx scripts/test-production.ts`, `npx tsx scripts/test-world-geometry.ts`, `npm run build`, and `npm audit`.

For the browser regression checks, install Playwright's Chromium (`npx playwright install chromium`), start the dev server, then run `npx tsx scripts/test-world-ui.ts`. Set `HEXFIELD_TEST_URL` if the server is not on port 5173, or `CHROMIUM_PATH` to use an existing Chromium executable.
