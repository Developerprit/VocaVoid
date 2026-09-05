#!/usr/bin/env python3
"""VocaVoid1 launcher — runs VV (console) + VF (VocaForge gateway) together.

Usage:
    python run.py                # starts VF on :8080, VV on :8000
    python run.py --vv-port 9000 --vf-port 8081
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
VOCAFORGE_DIR = os.environ.get("VOCAFORGE_DIR", r"E:\PC\VocaForge")
VF_CLI = os.path.join(VOCAFORGE_DIR, "vf_cli.py")
VV_SERVER = os.path.join(BASE, "vv_server.py")
PY = sys.executable

PROCS = []


def banner():
    print("=" * 56)
    print("  VocaVoid1  —  VF Music Editor  (VV + VF bundle)")
    print("=" * 56)


def start_vf(vf_host: str, vf_port: int) -> subprocess.Popen | None:
    if not os.path.isfile(VF_CLI):
        print(f"[run] WARN: VocaForge not found at {VF_CLI}")
        print("            VV will still run; synthesis needs the VF gateway.")
        return None
    cmd = [PY, VF_CLI, "api", "--host", vf_host, "--port", str(vf_port)]
    print(f"[run] starting VocaForge gateway: {' '.join(cmd)}")
    p = subprocess.Popen(cmd)
    PROCS.append(("VF", p))
    return p


def start_vv(vv_host: str, vv_port: int, vf_url: str) -> subprocess.Popen:
    cmd = [PY, VV_SERVER, "--host", vv_host, "--port", str(vv_port), "--vf", vf_url]
    print(f"[run] starting VocaVoid console:   {' '.join(cmd)}")
    p = subprocess.Popen(cmd)
    PROCS.append(("VV", p))
    return p


def wait_for_vf(vf_url: str, timeout: float = 20.0):
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(vf_url + "/api/v1/health", timeout=2) as r:
                if r.status == 200:
                    print(f"[run] VocaForge gateway is up: {vf_url}")
                    return True
        except Exception:
            time.sleep(0.5)
    print(f"[run] WARN: VocaForge gateway not reachable at {vf_url} (continuing).")
    return False


def shutdown():
    for name, p in PROCS:
        if p.poll() is None:
            print(f"[run] stopping {name}...")
            try:
                p.terminate()
            except Exception:
                pass
    for name, p in PROCS:
        try:
            p.wait(timeout=5)
        except Exception:
            p.kill()


def main():
    import argparse
    ap = argparse.ArgumentParser(description="VocaVoid1 bundle launcher")
    ap.add_argument("--vv-host", default="127.0.0.1")
    ap.add_argument("--vv-port", type=int, default=8000)
    ap.add_argument("--vf-host", default="127.0.0.1")
    ap.add_argument("--vf-port", type=int, default=8080)
    args = ap.parse_args()

    banner()
    start_vf(args.vf_host, args.vf_port)
    vf_url = f"http://{args.vf_host}:{args.vf_port}"
    start_vv(args.vv_host, args.vv_port, vf_url)
    wait_for_vf(vf_url)

    print()
    print(f"  Console:  http://{args.vv_host}:{args.vv_port}")
    print(f"  VocaForge /api/v1:  {vf_url}/api/v1")
    print("  Press Ctrl+C to stop both.")
    print()

    def handle_sig(signum, frame):
        print("\n[run] received stop signal.")
        shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sig)
    signal.signal(signal.SIGTERM, handle_sig)

    # keep alive: wait for any child to exit
    try:
        while True:
            time.sleep(1)
            for name, p in PROCS:
                if p.poll() is not None:
                    print(f"[run] {name} exited with code {p.returncode}.")
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
