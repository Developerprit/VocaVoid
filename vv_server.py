#!/usr/bin/env python3
"""VocaVoid backend — pure stdlib HTTP server.

Serves the Harvey UI console (frontend/), exposes the VocaVoid music-project
API (/vv/api/v1), proxies synthesis to the VocaForge gateway (/api/v1), and
serves generated WAVs (wav/).

English output in logs/errors. No third-party deps.
"""
from __future__ import annotations

import atexit
import json
import mimetypes
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

# ---- paths (resolved relative to this file's directory) -------------------
BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.join(BASE, "frontend")
PROJECTS = os.path.join(BASE, "projects")
VFVP = os.path.join(BASE, "vfvp")
WAV = os.path.join(BASE, "wav")

for d in (PROJECTS, VFVP, WAV):
    os.makedirs(d, exist_ok=True)

# ---- defaults --------------------------------------------------------------
DEFAULT_MODEL = "stub-zh"
DEFAULT_TEMPO = 100
DEFAULT_GRID = 0.25

MIME = {
    ".html": "text/html; charset=utf-8",
    ".hui": "text/plain; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
}

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_name(s: str, fallback: str) -> str:
    s = (s or "").strip().replace("\x00", "")
    return s or fallback


def read_json_file(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json_file(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)


# ---- VocaForge gateway proxy ----------------------------------------------
VF_URL = os.environ.get("VF_URL", "http://127.0.0.1:8080")


def vf_call(method: str, path: str, body: dict | None = None, raw: bytes | None = None):
    """Call the VocaForge /api/v1 gateway. Returns (status, dict|bytes)."""
    url = VF_URL.rstrip("/") + path
    data = None
    headers = {}
    if raw is not None:
        data = raw
        headers["Content-Type"] = "application/octet-stream"
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=120) as resp:
            ctype = resp.headers.get("Content-Type", "")
            payload = resp.read()
            if "application/json" in ctype:
                return resp.status, json.loads(payload.decode("utf-8"))
            return resp.status, payload
    except HTTPError as exc:
        try:
            detail = json.loads(exc.read().decode("utf-8"))
        except Exception:
            detail = {"error": exc.reason}
        return exc.code, detail
    except URLError as exc:
        return 502, {"error": f"VocaForge gateway unreachable: {exc.reason}"}


# ---- VocaForge gateway self-heal ------------------------------------------
# If no VF gateway is reachable when VV starts, spawn one so the console never
# hits a 502. (When run via run.py, VF is usually already up — we only spawn
# our own if the externally managed one never came online.)
VF_PROC = None


def _vf_reachable(vf_url: str, timeout: float = 1.5) -> bool:
    try:
        req = Request(vf_url.rstrip("/") + "/api/v1/health")
        with urlopen(req, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_vf(vf_url: str, vocaforge_dir: str | None = None):
    """Wait for a reachable VF gateway; if none appears, spawn one locally."""
    global VF_PROC
    host = urlparse(vf_url).hostname or "127.0.0.1"
    port = urlparse(vf_url).port or 8080
    # Give an externally started gateway a short grace window to come online.
    for _ in range(3):
        if _vf_reachable(vf_url):
            return
        time.sleep(0.5)
    vf_cli = os.path.join(vocaforge_dir or os.environ.get("VOCAFORGE_DIR", r"E:\PC\VocaForge"), "vf_cli.py")
    if not os.path.isfile(vf_cli):
        print(f"[VocaVoid] WARN: VocaForge not found at {vf_cli}; synthesis will be unavailable.")
        return
    try:
        VF_PROC = subprocess.Popen(
            [sys.executable, vf_cli, "api", "--host", host, "--port", str(port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        print(f"[VocaVoid] spawned VocaForge gateway (pid {VF_PROC.pid}) -> {vf_url}")
    except Exception as exc:  # noqa: BLE001
        print(f"[VocaVoid] WARN: could not start VocaForge gateway: {exc}")
        return
    for _ in range(16):
        if _vf_reachable(vf_url):
            print(f"[VocaForge] gateway auto-started and reachable: {vf_url}")
            return
        time.sleep(0.5)


def _stop_vf():
    if VF_PROC is not None and VF_PROC.poll() is None:
        try:
            VF_PROC.terminate()
        except Exception:
            pass


atexit.register(_stop_vf)


# ---- project helpers -------------------------------------------------------
def list_projects() -> list[dict]:
    out = []
    for fn in sorted(os.listdir(PROJECTS)):
        if not fn.endswith(".json"):
            continue
        try:
            p = read_json_file(os.path.join(PROJECTS, fn))
        except Exception:
            continue
        out.append({
            "id": p.get("id"),
            "name": p.get("name", "untitled"),
            "model_id": p.get("model_id", DEFAULT_MODEL),
            "tempo_bpm": p.get("tempo_bpm", DEFAULT_TEMPO),
            "note_count": len(p.get("notes", [])),
            "updated_at": p.get("updated_at"),
        })
    return out


def build_sequential_notes(notes: list[dict]) -> list[dict]:
    """VocaForge SynthProject is strictly sequential & monophonic.

    Sort by start time; insert rests (midi<=0) for gaps; drop overlaps.
    """
    seq = []
    cursor = 0.0
    for n in sorted(notes, key=lambda x: float(x.get("start", 0.0))):
        try:
            start = float(n.get("start", 0.0))
            dur = max(0.02, float(n.get("duration", 0.4)))
            midi = int(n.get("midi", 60))
            lyric = str(n.get("lyric", "")).strip() or "a"
        except (TypeError, ValueError):
            continue
        if start > cursor + 1e-4:
            seq.append({"lyric": "", "midi": 0, "duration": round(start - cursor, 4)})
        seq.append({"lyric": lyric, "midi": midi, "duration": round(dur, 4)})
        cursor = max(cursor, start + dur)
    return seq


# ---- request handler -------------------------------------------------------
class VVHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VocaVoid/1.0"

    # -- low level --
    def log_message(self, *args):  # silence default logging
        return

    def _send_json(self, code: int, body: dict):
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return {}

    def _serve_static(self, rel_path: str):
        if rel_path in ("", "/"):
            rel_path = "/index.html"
        # strip query
        rel_path = urlparse(rel_path).path
        # prevent traversal
        rel_path = rel_path.replace("\\", "/")
        clean = os.path.normpath(rel_path).lstrip("/\\")
        full = os.path.join(FRONTEND, clean)
        if not full.startswith(FRONTEND) or not os.path.isfile(full):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"404 Not Found")
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(os.path.getsize(full)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(full, "rb") as fh:
            self.wfile.write(fh.read())

    def _serve_wav(self, filename: str):
        full = os.path.join(WAV, os.path.basename(filename))
        if not os.path.isfile(full):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"404 wav not found")
            return
        size = os.path.getsize(full)
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            try:
                start_s, end_s = rng[len("bytes="):].split("-")
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else size - 1
                end = min(end, size - 1)
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                with open(full, "rb") as fh:
                    fh.seek(start)
                    self.wfile.write(fh.read(length))
                return
            except Exception:
                pass
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(full, "rb") as fh:
            self.wfile.write(fh.read())

    # -- routing --
    def do_OPTIONS(self):
        self.send_response(204)
        for k, v in CORS.items():
            self.send_header(k, v)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        p = urlparse(self.path)
        path = p.path
        if path == "/" or path == "/index.html":
            return self._serve_static("/index.html")
        if path.startswith("/vv/wav/"):
            return self._serve_wav(path[len("/vv/wav/"):])
        if path.startswith("/vv/api/v1/"):
            return self._api_get(path[len("/vv/api/v1/"):])
        # static assets under frontend
        if path.startswith("/vv/") or path.startswith("/components/") or path.startswith("/js/") or path.startswith("/css/") or path.startswith("/assets/"):
            return self._serve_static(path)
        return self._serve_static(path)

    def do_POST(self):
        p = urlparse(self.path)
        path = p.path
        if path.startswith("/vv/api/v1/"):
            return self._api_post(path[len("/vv/api/v1/"):])
        self._send_json(404, {"error": "not found", "path": path})

    def do_PUT(self):
        p = urlparse(self.path)
        path = p.path
        if path.startswith("/vv/api/v1/"):
            return self._api_put(path[len("/vv/api/v1/"):])
        self._send_json(404, {"error": "not found", "path": path})

    def do_DELETE(self):
        p = urlparse(self.path)
        path = p.path
        if path.startswith("/vv/api/v1/"):
            return self._api_delete(path[len("/vv/api/v1/"):])
        self._send_json(404, {"error": "not found", "path": path})

    # -- API: GET --
    def _api_get(self, sub: str):
        if sub == "health" or sub == "":
            st, vf = vf_call("GET", "/api/v1/health")
            return self._send_json(200, {
                "status": "ok",
                "vf_url": VF_URL,
                "vf_ok": st == 200,
                "vf": vf if st == 200 else None,
                "counts": {"projects": len(list_projects())},
            })
        if sub == "projects":
            return self._send_json(200, {"projects": list_projects()})
        if sub == "voicebanks":
            return self._send_json(200, self._voicebanks())  # dict: {voicebanks, vf_ok, vf_error}
        if sub.startswith("projects/"):
            pid = sub[len("projects/"):]
            fp = os.path.join(PROJECTS, f"{pid}.json")
            if not os.path.isfile(fp):
                return self._send_json(404, {"error": "project not found", "id": pid})
            return self._send_json(200, read_json_file(fp))
        return self._send_json(404, {"error": "not found", "path": sub})

    # -- API: POST --
    def _api_post(self, sub: str):
        if sub == "projects":
            body = self._read_body()
            pid = uuid.uuid4().hex[:12]
            proj = {
                "id": pid,
                "name": safe_name(body.get("name"), "未命名歌曲"),
                "tempo_bpm": int(body.get("tempo_bpm", DEFAULT_TEMPO)),
                "transpose": int(body.get("transpose", 0)),
                "model_id": safe_name(body.get("model_id"), DEFAULT_MODEL),
                "grid": float(body.get("grid", DEFAULT_GRID)),
                "notes": [],
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            write_json_file(os.path.join(PROJECTS, f"{pid}.json"), proj)
            return self._send_json(201, proj)
        if sub == "voicebanks/register":
            body = self._read_body()
            path = str(body.get("path") or "").strip()
            if not path.lower().endswith(".vfvp"):
                return self._send_json(400, {"error": "path must point to a .vfvp file"})
            if not os.path.isfile(path):
                return self._send_json(400, {"error": "file not found", "path": path})
            st, resp = vf_call("POST", "/api/v1/models", {"path": path})
            if st == 502:
                return self._send_json(503, {
                    "error": "VocaForge 网关无响应，无法注册声库。请确认 VocaForge 已启动（运行 python run.py 或 vf-cli api）。",
                    "vf_ok": False,
                })
            return self._send_json(st, resp)
        if sub.startswith("projects/") and sub.endswith("/synth"):
            pid = sub[len("projects/"):-len("/synth")]
            return self._synth(pid, self._read_body())
        return self._send_json(404, {"error": "not found", "path": sub})

    # -- API: PUT --
    def _api_put(self, sub: str):
        if sub.startswith("projects/"):
            pid = sub[len("projects/"):]
            fp = os.path.join(PROJECTS, f"{pid}.json")
            if not os.path.isfile(fp):
                return self._send_json(404, {"error": "project not found", "id": pid})
            body = self._read_body()
            proj = read_json_file(fp)
            if "name" in body:
                proj["name"] = safe_name(body["name"], proj["name"])
            if "tempo_bpm" in body:
                proj["tempo_bpm"] = max(20, min(400, int(body["tempo_bpm"])))
            if "transpose" in body:
                proj["transpose"] = max(-24, min(24, int(body["transpose"])))
            if "model_id" in body:
                proj["model_id"] = safe_name(body["model_id"], proj["model_id"])
            if "grid" in body:
                proj["grid"] = max(0.05, min(1.0, float(body["grid"])))
            if "notes" in body and isinstance(body["notes"], list):
                clean = []
                for n in body["notes"]:
                    if not isinstance(n, dict):
                        continue
                    clean.append({
                        "id": str(n.get("id") or uuid.uuid4().hex[:8]),
                        "midi": int(n.get("midi", 60)),
                        "start": max(0.0, float(n.get("start", 0.0))),
                        "duration": max(0.02, float(n.get("duration", 0.4))),
                        "lyric": str(n.get("lyric", "")),
                    })
                proj["notes"] = clean
            proj["updated_at"] = now_iso()
            write_json_file(fp, proj)
            return self._send_json(200, proj)
        return self._send_json(404, {"error": "not found", "path": sub})

    # -- API: DELETE --
    def _api_delete(self, sub: str):
        if sub.startswith("projects/"):
            pid = sub[len("projects/"):]
            fp = os.path.join(PROJECTS, f"{pid}.json")
            if not os.path.isfile(fp):
                return self._send_json(404, {"error": "project not found", "id": pid})
            os.remove(fp)
            return self._send_json(200, {"deleted": True, "id": pid})
        return self._send_json(404, {"error": "not found", "path": sub})

    # -- synth proxy --
    def _synth(self, pid: str, body: dict):
        fp = os.path.join(PROJECTS, f"{pid}.json")
        if not os.path.isfile(fp):
            return self._send_json(404, {"error": "project not found", "id": pid})
        proj = read_json_file(fp)
        model_id = safe_name(body.get("model_id") or proj.get("model_id"), DEFAULT_MODEL)
        transpose = int(body.get("transpose", proj.get("transpose", 0)))
        seq = build_sequential_notes(proj.get("notes", []))
        # apply transpose
        for n in seq:
            n["midi"] = max(0, min(127, n["midi"] + transpose))
        synth_project = {"name": proj.get("name", "song"), "sample_rate": 44100, "notes": seq}
        fname = f"{pid}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.wav"
        out_path = os.path.join(WAV, fname)
        st, resp = vf_call("POST", "/api/v1/synth", {
            "model": model_id,
            "project": synth_project,
            "out": out_path,
        })
        if st == 502:
            return self._send_json(503, {
                "error": "VocaForge 网关无响应，无法合成。请确认 VocaForge 已启动（运行 python run.py 或 vf-cli api），或稍后重试。",
                "vf_ok": False,
            })
        if st != 200:
            return self._send_json(st, resp)
        resp["url"] = f"/vv/wav/{fname}"
        resp["model_id"] = model_id
        return self._send_json(200, resp)

    # -- voicebanks aggregate --
    def _voicebanks(self) -> dict:
        vbs = []
        vf_ok = True
        vf_error = None
        # 1) VocaForge registered models
        st, resp = vf_call("GET", "/api/v1/models")
        if st == 200 and isinstance(resp, dict):
            for m in resp.get("models", []):
                vbs.append({
                    "id": m.get("id"),
                    "name": m.get("name", m.get("id")),
                    "lang": m.get("lang"),
                    "backend": m.get("backend"),
                    "source": "vocaforge",
                    "path": m.get("path", ""),
                })
        elif st == 502:
            # VocaForge gateway is down — degrade gracefully, do not 502.
            vf_ok = False
            vf_error = "VocaForge 网关无响应（合成不可用，但编辑器正常工作）。"
        # 2) local .vfvp files (may need py7zr to read meta)
        for fn in sorted(os.listdir(VFVP)):
            if not fn.lower().endswith(".vfvp"):
                continue
            full = os.path.join(VFVP, fn)
            vbs.append({
                "id": fn,
                "name": fn,
                "lang": None,
                "backend": "vfvp",
                "source": "local",
                "path": full,
                "registered": any(v.get("path") == full for v in vbs),
            })
        return {"voicebanks": vbs, "vf_ok": vf_ok, "vf_error": vf_error}


def run_server(host: str = "127.0.0.1", port: int = 8000):
    httpd = HTTPServer((host, port), VVHandler)
    print(f"[VocaVoid] console listening on http://{host}:{port}")
    print(f"[VocaVoid] VocaForge gateway target: {VF_URL}")
    # Self-heal in the background so the console comes up instantly even if VF
    # is not running yet.
    import threading
    threading.Thread(target=ensure_vf, args=(VF_URL,), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="VocaVoid backend server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--vf", default=None, help="VocaForge gateway base URL")
    args = ap.parse_args()
    if args.vf:
        VF_URL = args.vf
    run_server(args.host, args.port)
