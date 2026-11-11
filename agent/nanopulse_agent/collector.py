"""Telemetry collection with psutil.

Collects only system health data: resource utilization, network counters, uptime, host
identity and process names/resource usage. It never reads files, browser data,
credentials, keystrokes or window contents.
"""

from __future__ import annotations

import logging
import os
import platform
import socket
import time
from urllib.parse import urlparse

import psutil

from .config import DEMO_MARKER

log = logging.getLogger("nanopulse.collector")


def system_drive() -> str:
    if os.name == "nt":
        return os.environ.get("SystemDrive", "C:") + "\\"
    return "/"


def primary_ip(server_url: str | None = None) -> str | None:
    """Local address used to reach the server (UDP connect sends no packets)."""
    host = urlparse(server_url).hostname if server_url else None
    target = host if host and host not in ("localhost", "127.0.0.1") else "8.8.8.8"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect((target, 80))
            return s.getsockname()[0]
    except OSError:
        return None


def host_info(server_url: str | None = None) -> dict:
    return {
        "hostname": socket.gethostname(),
        "operatingSystem": f"{platform.system()} {platform.release()}".strip(),
        "osVersion": platform.version(),
        "architecture": platform.machine(),
        "ipAddress": primary_ip(server_url),
    }


def tcp_probe(target: str, timeout: float = 2.0) -> tuple[bool, float | None, str | None]:
    host, _, port = target.rpartition(":")
    start = time.perf_counter()
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True, round((time.perf_counter() - start) * 1000, 1), None
    except (OSError, ValueError) as exc:
        return False, None, str(exc)


class MetricsCollector:
    def __init__(self, process_limit: int = 10, connectivity_hosts: list[str] | None = None,
                 connectivity_check: bool = True, server_url: str | None = None):
        self.process_limit = process_limit
        self.connectivity_hosts = connectivity_hosts or []
        self.connectivity_check = connectivity_check
        self.server_url = server_url
        self.cpu_count = psutil.cpu_count(logical=True) or 1
        self._procs: dict[int, psutil.Process] = {}
        self._last_net = None
        self._last_net_time = None
        psutil.cpu_percent(interval=None)  # prime: first call always returns 0.0
        self.processes()  # prime per-process CPU counters the same way

    # ---- individual metrics -------------------------------------------------
    def cpu(self) -> float:
        return round(psutil.cpu_percent(interval=None), 1)

    def memory(self) -> dict:
        vm = psutil.virtual_memory()
        return {"ramUsage": round(vm.percent, 1), "ramTotalBytes": vm.total, "ramAvailableBytes": vm.available}

    def disk(self) -> dict:
        du = psutil.disk_usage(system_drive())
        return {"diskUsage": round(du.percent, 1), "diskTotalBytes": du.total, "diskFreeBytes": du.free}

    def network(self) -> dict:
        now = time.monotonic()
        io = psutil.net_io_counters()
        up = down = 0.0
        if self._last_net is not None and now > self._last_net_time:
            elapsed = now - self._last_net_time
            up = max(0.0, (io.bytes_sent - self._last_net.bytes_sent) / elapsed)
            down = max(0.0, (io.bytes_recv - self._last_net.bytes_recv) / elapsed)
        self._last_net, self._last_net_time = io, now
        return {
            "networkUpload": round(up),
            "networkDownload": round(down),
            "networkBytesSent": io.bytes_sent,
            "networkBytesRecv": io.bytes_recv,
        }

    def connectivity(self) -> bool:
        if not self.connectivity_check or not self.connectivity_hosts:
            return True
        return any(tcp_probe(t)[0] for t in self.connectivity_hosts)

    def interfaces(self) -> list[dict]:
        out = []
        stats = psutil.net_if_stats()
        for name, addrs in psutil.net_if_addrs().items():
            ipv4 = [a.address for a in addrs if a.family == socket.AF_INET and not a.address.startswith("127.")]
            if not ipv4:
                continue
            st = stats.get(name)
            out.append({"name": name[:200], "addresses": ipv4[:10], "isUp": bool(st and st.isup),
                        "speedMbps": st.speed if st else 0})
        return out[:16]

    def uptime(self) -> int:
        return int(time.time() - psutil.boot_time())

    def processes(self) -> list[dict]:
        """Top processes by CPU. CPU is normalised to % of total machine capacity.

        Child processes of the configured demo app are folded into the demo app entry so
        the application is reported as one unit (it uses one worker per core when burning CPU).
        """
        seen: dict[int, dict] = {}
        current: dict[int, psutil.Process] = {}
        demo_roots: set[int] = set()
        # Attributes are read directly (not via process_iter(attrs) / .info): psutil shares cached
        # Process objects across threads, so .info can be overwritten by a concurrent action.
        for proc in psutil.process_iter():
            pid = proc.pid
            if pid == 0:  # "System Idle Process" reports idle time, not load
                continue
            cached = self._procs.get(pid)
            p = cached if cached is not None and cached.is_running() else proc
            current[pid] = p
            try:
                with p.oneshot():
                    cpu = p.cpu_percent(interval=None) / self.cpu_count
                    name = p.name() or f"pid-{pid}"
                    try:
                        mem_bytes = p.memory_info().rss
                        mem_pct = p.memory_percent()
                    except psutil.AccessDenied:
                        mem_bytes, mem_pct = 0, 0.0
                if "python" in name.lower():
                    try:
                        if DEMO_MARKER in p.cmdline():
                            demo_roots.add(pid)
                    except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess):
                        pass
                seen[pid] = {
                    "pid": pid,
                    "name": name[:260],
                    "cpuPercent": cpu,
                    "memoryPercent": mem_pct or 0.0,
                    "memoryBytes": mem_bytes,
                }
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
        self._procs = current

        for root in demo_roots:
            entry = seen.get(root)
            if not entry:
                continue
            entry["isDemoApp"] = True
            entry["name"] = "nanopulse-demo-worker"
            try:
                for child in psutil.Process(root).children(recursive=True):
                    c = seen.pop(child.pid, None)
                    if c:
                        entry["cpuPercent"] += c["cpuPercent"]
                        entry["memoryPercent"] += c["memoryPercent"]
                        entry["memoryBytes"] += c["memoryBytes"]
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        top = sorted(seen.values(), key=lambda x: x["cpuPercent"], reverse=True)[: self.process_limit]
        for p in top:
            p["cpuPercent"] = round(min(100.0, p["cpuPercent"]), 1)
            p["memoryPercent"] = round(min(100.0, p["memoryPercent"]), 2)
        return top

    # ---- full sample --------------------------------------------------------
    def collect(self) -> dict:
        sample = {
            "cpuUsage": self.cpu(),
            "cpuCount": self.cpu_count,
            **self.memory(),
            **self.disk(),
            **self.network(),
            "networkConnected": self.connectivity(),
            "uptimeSeconds": self.uptime(),
            "processes": self.processes(),
            "interfaces": self.interfaces(),
        }
        ip = primary_ip(self.server_url)
        if ip:
            sample["ipAddress"] = ip
        return sample
