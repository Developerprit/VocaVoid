# VocaVoid

> A **VF music editor** with a web console, built on **VocaForge 0.4.2** (backend synthesis) and **Harvey UI** (frontend).
> [中文文档 / Chinese](./README-zh.md)

Compose melodies on a piano-roll, attach lyrics to each note, pick a voicebank
(`.vfvp`), and synthesize singing voice straight from the browser. VocaVoid runs
**VocaVoid (VV) + VocaForge (VF)** together as one bundle.

---

## Features

- **Piano-roll editor** — click to place notes, drag to move, resize duration, double-click to edit lyrics.
- **Per-note lyrics** — each note carries its own syllable/word for singing synthesis.
- **Voicebank picker** — choose from registered `.vfvp` libraries or the built-in `stub-zh` test voice.
- **One-click synthesis** — sends the song to VocaForge and writes a WAV into `wav/`.
- **Project persistence** — songs are saved as JSON in `projects/`.
- **Dark Synth Studio UI** with a light theme, built with Harvey UI components.
- **No heavy deps** — the VV backend is pure Python stdlib; VocaForge runs the stub backend without models.

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend engine | [VocaForge 0.4.2](https://github.com/Developerprit/VocaForge) (`/api/v1` REST gateway) |
| Console backend | `vv_server.py` — stdlib `http.server` (static + `/vv/api/v1` + synth proxy) |
| Frontend | [Harvey UI](https://harveyui.rth1.xyz) (`<hui>` components) + Canvas piano-roll |
| Launcher | `run.py` — starts VV + VF together |
| Icon | `VV_icon.png` |

## Quick start

```bash
# from the VocaVoid folder
python run.py
# console  -> http://127.0.0.1:8000
# VocaForge -> http://127.0.0.1:8080/api/v1
```

Requirements: Python 3.9+. No `pip install` needed for the core flow
(the built-in `stub-zh` voicebank synthesizes without any model).

> To use real `.vfvp` voicebanks you need `py7zr`:
> `pip install py7zr` (install into your managed venv).

## How it works

```
Browser (Harvey UI console + Canvas piano-roll)
        │  /vv/*
        ▼
VocaVoid backend :8000  ── synth proxy ──▶  VocaForge gateway :8080  (/api/v1)
        │                                      │  import vocaforge
   projects/  vfvp/  wav/                      ▼  DiffSinger / StubBackend
```

- **VV** serves the console and stores songs (`projects/*.json`).
- **VF** (VocaForge) exposes synthesis (`/api/v1/synth`) and model registry.
- The synth request is proxied server-to-server, so the browser only talks to VV.

### Data locations

| Path | Purpose |
|------|---------|
| `vfvp/`   | voicebank `.vfvp` packages (drop your libraries here) |
| `wav/`    | generated singing WAV files |
| `projects/` | VocaVoid song projects (JSON) |

## API (VocaVoid)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/vv/api/v1/health` | VV alive + VF connectivity |
| GET/POST | `/vv/api/v1/projects` | list / create songs |
| GET/PUT/DELETE | `/vv/api/v1/projects/{id}` | read / save / delete a song |
| GET | `/vv/api/v1/voicebanks` | aggregate registered + local `.vfvp` |
| POST | `/vv/api/v1/voicebanks/register` | register a local `.vfvp` into VocaForge |
| POST | `/vv/api/v1/projects/{id}/synth` | synthesize → WAV in `wav/` |
| GET | `/vv/wav/{file}` | stream a generated WAV |

## Project layout

```
VocaVoid/
├── run.py              # launcher (VV + VF)
├── vv_server.py        # VocaVoid backend
├── frontend/
│   ├── index.html      # Harvey UI console
│   ├── hui.js          # Harvey UI engine (local copy)
│   ├── css/theme.css   # Dark Synth Studio design system
│   ├── components/     # .hui chrome (Header / Sidebar / Transport)
│   ├── js/api.js       # VV API client
│   ├── js/pianoroll.js # Canvas piano-roll engine
│   └── js/app.js       # console controller
├── vfvp/  wav/  projects/
├── LICENSE
└── index.html          # public landing page
```

## License

[Available License](https://license.kscm.top/available.md) · © 2026 kscm (初陌 / Developer-prit)
