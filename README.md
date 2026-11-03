# Hexfield — 4X Tactical Simulator

Run with `npm run dev`; build with `npm run build`.

## Simulation (combat + AI)
- Combat is **simultaneous only**. All attacks resolve before movement: a targeted unit cannot retreat, mutual attacks kill both, and two units targeting one tile cancel. A unit may move onto a tile vacated by an ally in the same round; movement chains resolve in dependency order.
- AI: three-move selective lookahead for both sides, memoized rollouts, seeded self-play diversity. Settlers value founding cities; armies value capitals and city pressure.
- Runs use a worker pool (max 8) or **Low power** (1 worker). Custom rules are copied to every worker. Editing geometry invalidates learned per-unit weights.
- Bundled studies predate the 4X/Settler rules and are labelled historical; old data is normalized so reports never crash.

## 4X Play
- Select Play. Each player starts with **one Settler** and no cities. Settlers move to any empty tile within two rings (18 tiles).
- Select a Settler → **Special Actions → Found a City**. Orders resolve when the round ends. The settler is consumed. Your first city is your **Capital** and claims its centre + 6 adjacent tiles.
- Cities generate **2 production/turn**; every unit costs **5**. Each unit type keeps its own paused progress. Switching back resumes that progress. Excess production from a completed unit becomes city-wide overflow, applied once to the selected project on the next turn. Cities complete at most one unit per turn. Units spawn on the city centre or a free territory tile; a blocked spawn retains its production.
- Cities are captured only by the existing six-hex encirclement rule. Enemy movement and advancing attacks cannot enter or pass through an enemy city centre. Brown ranged attacks can still attack a garrison without entering.
- Victory: control **ceil(2/3 × players)** capitals. A player with no units and no cities is eliminated. Simulation measurements cap at **100 rounds**, training games at **50 rounds**, then adjudicate by capitals, cities and material. Human matches are not capped by these simulation limits.
- Maps: Duel 22×16 (no wrap), Clash 32×24, Battle 40×30, War 50×38 (all west–east wrapping). Player count is independent of map size.
- Pan with click-drag, zoom with the toolbar or mouse wheel, centre on your capital with the compass button. Wrapping maps repeat visually and units, projectiles and order lines use the nearest image across the seam. Duel does not repeat. City and special-action menus overlay the bottom-right of the map. End turn, enemy reach and fullscreen are in the map's top bar.
- Orders deselect the unit automatically; reselect it to change the order. Assigned orders draw thin green/red/yellow lines.

## Live online
Host: choose **2-10 players**, select Online P2P, create a room, and share the invitation. Each joining browser gets its own civilization seat; the host is player 1. The host validates ownership of unit orders and production choices, waits for every active seat to lock orders, and broadcasts the resolved world. Chunked binary WebRTC messages support large maps and snapshots. All active seats must be connected before play; disconnected seats are reserved for rejoining from the same browser session. Keep the host tab open. This remains peer-hosted, not a persistent dedicated server.

Uses PeerJS public signalling/WebRTC; strict NATs may need TURN. Deploy on public HTTPS (a localhost link is not shareable). Optional build variables: `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_SECURE`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.

## Checks
`npx tsc --noEmit`, `npx tsx scripts/test-engine.ts`, `npx tsx scripts/test-production.ts`, `npm run build`.
