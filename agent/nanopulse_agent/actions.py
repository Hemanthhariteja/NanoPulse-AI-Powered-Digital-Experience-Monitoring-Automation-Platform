"""Allowlisted remediation actions.

The server sends only an action name and parameters. Each name maps to a built-in Python
function below; anything else is rejected. No action runs a shell, evaluates code, or
accepts a path/executable from the server. Keep in sync with
backend/src/services/remediation/catalog.js.
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess

import threading
import time
from dataclasses import dataclass
from pathlib import Path

import psutil

from .collector import system_drive, tcp_probe
from .config import DEMO_MARKER, AgentConfig

log = logging.getLogger("nanopulse.actions")


class ActionError(Exception):
    pass


@dataclass
class ActionContext:
    config: AgentConfig


def _int_param(params: dict, name: str, default: int, lo: int, hi: int) -> int:
    value = params.get(name, default)
    if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
        raise ActionError(f"Parameter '{name}' must be an integer between {lo} and {hi}")
    return value


def _reject_unknown(params: dict, allowed: set[str]) -> None:
    extra = set(params) - allowed
    if extra:
        raise ActionError(f"Unexpected parameters: {', '.join(sorted(extra))}")


def _snapshot() -> dict:
    return {
        "cpuUsage": psutil.cpu_percent(interval=0.5),
        "ramUsage": psutil.virtual_memory().percent,
        "diskUsage": psutil.disk_usage(system_drive()).percent,
    }


# ---- read-only diagnostics ----------------------------------------------------

def list_top_cpu_processes(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, {"limit"})
    limit = _int_param(params, "limit", 10, 1, 25)
    cores = psutil.cpu_count() or 1
    # Fresh Process objects: psutil's process_iter cache is shared with the telemetry
    # collector, and calling cpu_percent() on a shared object would reset its baseline.
    procs = []
    for pid in psutil.pids():
        if pid == 0:
            continue
        try:
            p = psutil.Process(pid)
            p.cpu_percent(None)
            procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    time.sleep(1.0)  # measure over a real 1-second window
    rows = []
    for p in procs:
        try:
            rows.append({"pid": p.pid, "name": p.name(), "cpuPercent": round(p.cpu_percent(None) / cores, 1)})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    rows.sort(key=lambda r: r["cpuPercent"], reverse=True)
    top = rows[:limit]
    lead = f"{top[0]['name']} ({top[0]['cpuPercent']}% CPU)" if top else "none"
    return {"status": "SUCCEEDED", "summary": f"Top CPU consumer: {lead}", "data": {"processes": top},
            "verification": _snapshot()}


def list_top_memory_processes(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, {"limit"})
    limit = _int_param(params, "limit", 10, 1, 25)
    rows = []
    for pid in psutil.pids():
        try:
            p = psutil.Process(pid)
            with p.oneshot():
                rows.append({"pid": pid, "name": p.name(), "memoryBytes": p.memory_info().rss,
                             "memoryPercent": round(p.memory_percent() or 0, 2)})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    rows.sort(key=lambda r: r["memoryBytes"], reverse=True)
    top = rows[:limit]
    lead = f"{top[0]['name']} ({top[0]['memoryBytes'] / 1024 ** 2:.0f} MB)" if top else "none"
    return {"status": "SUCCEEDED", "summary": f"Largest memory consumer: {lead}", "data": {"processes": top},
            "verification": _snapshot()}


def check_network_connectivity(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, set())
    probes = []
    for target in ctx.config.connectivity_hosts[:5]:
        ok, latency, err = tcp_probe(target, timeout=3)
        probes.append({"target": target, "reachable": ok, "latencyMs": latency, "error": err})
    try:
        socket.getaddrinfo("www.microsoft.com", 443)
        dns = "ok"
    except OSError as exc:
        dns = f"failed: {exc}"
    reachable = sum(p["reachable"] for p in probes)
    return {
        "status": "SUCCEEDED",
        "summary": f"{reachable}/{len(probes)} probes reachable; DNS {dns.split(':')[0]}",
        "data": {"probes": probes, "dns": dns},
        "verification": {"networkConnected": reachable > 0},
    }


def network_diagnostics(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, set())
    stats = psutil.net_if_stats()
    interfaces = []
    for name, addrs in psutil.net_if_addrs().items():
        st = stats.get(name)
        interfaces.append({
            "name": name,
            "isUp": bool(st and st.isup),
            "speedMbps": st.speed if st else None,
            "mtu": st.mtu if st else None,
            "addresses": [a.address for a in addrs if a.family in (socket.AF_INET, socket.AF_INET6)][:6],
        })
    io = psutil.net_io_counters()
    connections = {"available": True}
    try:
        conns = psutil.net_connections(kind="inet")
        connections.update({
            "established": sum(1 for c in conns if c.status == psutil.CONN_ESTABLISHED),
            "listening": sum(1 for c in conns if c.status == psutil.CONN_LISTEN),
            "total": len(conns),
        })
    except (psutil.AccessDenied, PermissionError):
        connections = {"available": False, "reason": "Requires elevated privileges on this OS"}
    up = [i["name"] for i in interfaces if i["isUp"]]
    return {
        "status": "SUCCEEDED",
        "summary": f"{len(up)} interface(s) up; {connections.get('established', 'n/a')} established connections",
        "data": {
            "interfaces": interfaces,
            "counters": {"bytesSent": io.bytes_sent, "bytesRecv": io.bytes_recv, "errin": io.errin,
                         "errout": io.errout, "dropin": io.dropin, "dropout": io.dropout},
            "connections": connections,
        },
        "verification": {"interfacesUp": len(up)},
    }


# ---- corrective actions ---------------------------------------------------------

def resolve_safe_dir(raw: str) -> Path:
    """Validate the configured safe temp directory; refuse anything that could hold user data."""
    path = Path(raw)
    if path.is_symlink():
        raise ActionError("Safe temp directory must not be a symbolic link")
    path = path.resolve()
    if not path.is_dir():
        raise ActionError(f"Safe temp directory does not exist: {path}")
    forbidden = {Path(path.anchor), Path.home().resolve()}
    for env in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "USERPROFILE"):
        if os.environ.get(env):
            forbidden.add(Path(os.environ[env]).resolve())
    for name in ("Documents", "Desktop", "Downloads", "Pictures", "OneDrive"):
        forbidden.add((Path.home() / name).resolve())
    if path in forbidden or len(path.parts) < 3:
        raise ActionError(f"Refusing to clean protected directory: {path}")
    return path


def clear_temp_files(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, {"olderThanHours", "dryRun"})
    hours = _int_param(params, "olderThanHours", 24, 0, 720)
    dry_run = params.get("dryRun", False)
    if not isinstance(dry_run, bool):
        raise ActionError("Parameter 'dryRun' must be a boolean")

    root = resolve_safe_dir(ctx.config.safe_temp_dir)
    cutoff = time.time() - hours * 3600
    before = psutil.disk_usage(system_drive()).percent
    deleted = skipped = errors = 0
    freed = 0
    for dirpath, _dirs, files in os.walk(root, followlinks=False):
        for fname in files:
            fpath = Path(dirpath) / fname
            try:
                if fpath.is_symlink():
                    skipped += 1
                    continue
                resolved = fpath.resolve()
                if not resolved.is_relative_to(root):  # containment check
                    skipped += 1
                    continue
                st = resolved.stat()
                if st.st_mtime > cutoff:
                    skipped += 1
                    continue
                if not dry_run:
                    resolved.unlink()
                deleted += 1
                freed += st.st_size
            except OSError as exc:
                errors += 1
                log.warning("Could not remove %s: %s", fpath, exc)
    after = psutil.disk_usage(system_drive()).percent
    verb = "Would delete" if dry_run else "Deleted"
    return {
        "status": "SUCCEEDED" if errors == 0 else "FAILED",
        "summary": f"{verb} {deleted} file(s), {freed / 1024 ** 2:.1f} MB from {root}",
        "data": {"directory": str(root), "filesDeleted": 0 if dry_run else deleted, "candidates": deleted,
                 "bytesFreed": 0 if dry_run else freed, "skipped": skipped, "errors": errors,
                 "olderThanHours": hours, "dryRun": dry_run},
        "verification": {"diskUsageBefore": before, "diskUsageAfter": after},
        **({"error": f"{errors} file(s) could not be removed"} if errors else {}),
    }


def find_demo_processes() -> list[psutil.Process]:
    found = []
    for pid in psutil.pids():
        try:
            p = psutil.Process(pid)
            if "python" not in (p.name() or "").lower():
                continue
            cmd = p.cmdline()
            if DEMO_MARKER in cmd and any(part.endswith("demo_app.py") for part in cmd):
                found.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    return found


def restart_demo_app(params: dict, ctx: ActionContext) -> dict:
    _reject_unknown(params, set())
    cfg = ctx.config
    if not cfg.enable_demo_app:
        raise ActionError("The demo application is not enabled on this agent (--enable-demo-app)")
    command = list(cfg.demo_app_command)
    if DEMO_MARKER not in command or not any(str(c).endswith("demo_app.py") for c in command):
        raise ActionError("Configured demo app command must run demo_app.py with the NanoPulse marker")

    before = _snapshot()
    stopped = []
    for proc in find_demo_processes():
        try:
            children = proc.children(recursive=True)
            for c in children:
                c.terminate()
            proc.terminate()
            _, alive = psutil.wait_procs([proc, *children], timeout=5)
            for a in alive:
                a.kill()
            stopped.append(proc.pid)
        except psutil.NoSuchProcess:
            continue

    kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    new = subprocess.Popen(command, shell=False, **kwargs)  # noqa: S603 — fixed, validated argv
    time.sleep(1.5)
    running = new.poll() is None
    after = _snapshot()
    return {
        "status": "SUCCEEDED" if running else "FAILED",
        "summary": (f"Restarted demo app (stopped PID {', '.join(map(str, stopped)) or 'none'}, new PID {new.pid})"
                    if running else "Demo app exited immediately after restart"),
        "data": {"stoppedPids": stopped, "newPid": new.pid, "command": [Path(c).name for c in command]},
        "verification": {"before": before, "after": after, "processRunning": running},
        **({} if running else {"error": f"Exit code {new.returncode}"}),
    }


ACTIONS = {
    "list_top_cpu_processes": list_top_cpu_processes,
    "list_top_memory_processes": list_top_memory_processes,
    "check_network_connectivity": check_network_connectivity,
    "network_diagnostics": network_diagnostics,
    "clear_temp_files": clear_temp_files,
    "restart_demo_app": restart_demo_app,
}


def run_action(command: dict, ctx: ActionContext, timeout: float | None = None) -> dict:
    """Validate and execute one command with a timeout. Always returns a result dict."""
    action_type = command.get("actionType")
    handler = ACTIONS.get(action_type)
    started = time.perf_counter()
    if handler is None:
        return {"status": "FAILED", "summary": "Action rejected by agent allowlist",
                "error": f"Unknown action '{action_type}'", "mode": "REAL", "durationMs": 0}
    params = command.get("parameters") or {}
    if not isinstance(params, dict):
        return {"status": "FAILED", "summary": "Invalid parameters", "error": "parameters must be an object",
                "mode": "REAL", "durationMs": 0}

    box: dict = {}

    def target():
        try:
            box["result"] = handler(params, ctx)
        except ActionError as exc:
            box["result"] = {"status": "FAILED", "summary": "Action validation failed", "error": str(exc)}
        except Exception as exc:  # noqa: BLE001 — report every failure to the server
            log.exception("Action %s crashed", action_type)
            box["result"] = {"status": "FAILED", "summary": "Action raised an error", "error": f"{type(exc).__name__}: {exc}"}

    worker = threading.Thread(target=target, name=f"action-{action_type}", daemon=True)
    worker.start()
    worker.join(timeout or command.get("timeoutSeconds") or 60)
    if worker.is_alive():
        result = {"status": "FAILED", "summary": "Action timed out on the agent",
                  "error": f"Exceeded {timeout or command.get('timeoutSeconds')}s"}
    else:
        result = box["result"]
    result["mode"] = "REAL"
    result["durationMs"] = round((time.perf_counter() - started) * 1000)
    result["summary"] = str(result.get("summary", ""))[:2000] or "No summary"
    return result


__all__ = ["ACTIONS", "ActionContext", "ActionError", "run_action", "resolve_safe_dir"]
