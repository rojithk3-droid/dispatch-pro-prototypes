# Dispatch Pro — Prototypes

Static HTML prototypes for the Dispatch Pro TMS. No build step: each page is a single `.html` file (Inter, Lucide and Three.js load from CDNs).

**Start here:** [`build-asset.html`](build-asset.html) — the Build Asset page.

- Pick an asset type (Truck / Trailer) and axle count, then set tires, max weight and tire pressure per axle.
- A live 3D model builds as you type (built in code, no model files): a truck and a van trailer.
- Views (Iso / Top / Side / Front), Pressure and Load modes, X-ray, image download, hover cards on every axle, save/load in the browser, dark mode.

Open [`index.html`](index.html) for a launcher to every page.

## Run locally

Any static server works; the repo root is the site root.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1   # http://localhost:8791
```

## Design system

Pages follow the house "shadcn/ui at 80%" system: `body{zoom:.8}`, every length a multiple of 1.25px, even line-heights, no shadows, one blue hover. See `.claude/skills/newdpdesignsystem/` for the tokens and component catalog.

## Notes

- No third-party 3D model files are included (`*.glb`, `*.fbx`, `*.obj`, ... are git-ignored). `nyc-3d.html` therefore runs without its pedestrian avatars.