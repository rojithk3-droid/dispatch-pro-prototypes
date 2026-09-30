# DZone

A browser battle royale in the spirit of PUBG, set in Indian cities and regions: Koramangala (real map), Bengaluru Classic, Kochi, Chennai, Thiruvananthapuram, Thrissur, Delhi, Gurugram, Meghalaya, Aizawl, Nagaland and Spiti Valley. Three.js, no build step.

## Koramangala (real map, night)

The Koramangala map is built from real **OpenStreetMap** data (Map data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright). It is 3.7 km across at 1:1 scale, from Silk Board Junction up to the Inner Ring Road and from Adugodi to Ejipura, and includes:

- all 3,046 mapped roads at their real positions, with names, widths from road type and lane count, and the Silk Board flyover raised;
- all ~22,400 mapped building footprints. About 900 near-rectangular, house-sized buildings are enterable with stairs and loot; the rest are solid, extruded to plausible heights (OSM rarely records storeys), with lit windows at night;
- ~1,440 named shops, restaurants, pubs, banks and clinics, each with its name on a sign facing its street and loot at the door;
- the real parks and grounds (Wipro Park, NGV Grounds, Koramangala Club…) and the real neighbourhood names on the map.

Google Maps and Street View are not used: their terms forbid copying their data or imagery. Building colours, facades and billboard ads are generated, not photographed. OSM records very few real billboards, so the hoardings carry DZone's own Bengaluru jokes. `data/koramangala.json` was produced from the Overpass API, bounding box 12.9170,77.6060 to 12.9480,77.6400.

## Run it

Double-click **`Play DZone.cmd`** in this folder. It starts the local game server in a black window and opens http://localhost:8795/ in your default browser (Edge, Chrome or Firefox). Keep the black window open while you play; close it to stop the server.

Or from a terminal:

```
powershell -ExecutionPolicy Bypass -File dzone\server\dzone-server.ps1 -Open
```

Don't open `index.html` directly: every browser blocks the game's scripts on `file://`, and the page now says so. The server needs Windows PowerShell 5.1+ and nothing else. It serves the game and runs the WebSocket relay used for multiplayer.

**Play with friends on your network:** start the server with `-Lan` (run as admin once, or run `netsh http add urlacl url=http://+:8795/ user=Everyone`). Allow port 8795 through the firewall. Friends then open `http://<your-ip>:8795/`.

**No server:** opening the files from any other static server puts the game in *Local mode*. Every tab in the same browser can still find the others and play together.

The first load of each map downloads CC0 photo textures and HDRI skies from Poly Haven, plus the soldier model from the three.js repository. Later loads come from the browser cache.

## Multiplayer

- Log in with a unique username. Use **Friends** to search for online players by name, add friends and send invites.
- An invite drops the other player into your squad (up to 4). The squad leader picks the city, the mode (solo / duo / squad), the bot count and the difficulty.
- **PLAY** launches everyone in your squad into one shared match. **HOST** also lists the match publicly under *Open matches* for 45 seconds so anyone can join the warm-up.
- The host runs the bots, the clock and the airdrops. If the host leaves, another player takes over.

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| WASD | Move | Shift / Ctrl | Sprint / walk |
| Space | Jump, vault | C / Z | Crouch / prone |
| Mouse L / R | Fire / aim down sights | R, B | Reload, fire mode |
| 1–4, wheel | Weapons | 5 or G | Throwable (hold L for power, release to throw) |
| X | Holster | 7 8 9 0 | Bandage, first aid, med kit, boost / local food |
| F | Interact: loot, vehicles, climb, revive, jump, open chute | Tab | Inventory |
| M | Map (right-click to place a marker) | V | First / third person |
| Alt | Free look | T / Enter | Chat (the host presses Enter in warm-up to start) |
| H | Horn | = | Auto-run |
| Arrow keys | Look around (also works when the browser won't capture the mouse) | K | Show / hide the on-screen controls panel |

Click the game view once to capture the mouse (Esc releases it). Moving the mouse right turns you right, left turns left, up looks up and down looks down, whether or not the browser captures the mouse. Settings has **Invert mouse left / right** and **up / down** if you prefer otherwise. The panel at bottom-left always shows the controls for what you are doing right now, and lights up keys as you press them.

## What's in it

- **Match flow:** warm-up, drop plane, freefall and parachute, 7-phase blue zone, "Amma's Tiffin" airdrops, knock and revive in duo and squad, spectating, results.
- **Guns:** the M416, SCAR-L, AKM, UMP45, Vector, Mini 14, SKS, Kar98k, AWM, S12K and P92. Bullets are real projectiles with travel time, drop and falloff. Hits land on bone-accurate hitboxes (head, body, limbs). Recoil, bloom, ADS through sight models, scopes up to 8x, suppressors, compensators, grips and extended mags. The Dosa Tawa stops bullets on your back.
- **Enterable buildings:** stairs, rooftop stair rooms, window grills and balconies, plus shops with shutters and signboards in local scripts.
- **Drivable vehicles:** auto-rickshaws, Gypsys, Bullets, KSRTC buses and boats.
- **Easter eggs:** about 170 hidden across the cities, plus a few triggered by doing things: drive a lap of Swaraj Round, try to honk in Aizawl, hit a Bengaluru pothole, win with the tawa. The collection is tracked in the lobby.

`dev/` holds test pages: `maptest.html` generates every map and reports errors, `worldtest.html?map=<id>` is a free-orbit world viewer, and `chartest.html` shows the soldier poses. Opening `/?quick=<map>&bots=<n>` skips the menus.
