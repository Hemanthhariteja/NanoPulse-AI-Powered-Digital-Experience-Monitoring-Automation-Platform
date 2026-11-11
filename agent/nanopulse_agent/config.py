"""Agent configuration: defaults < config.json < environment variables < CLI arguments."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
DEMO_MARKER = "--nanopulse-demo"


@dataclass
class AgentConfig:
    server_url: str = "http://localhost:5000"
    enrollment_key: str | None = None
    interval_seconds: float = 10.0
    command_poll_seconds: float = 3.0
    request_timeout_seconds: float = 10.0
    max_retries: int = 3
    process_limit: int = 10
    state_dir: str = str(AGENT_ROOT / "state")
    log_dir: str = str(AGENT_ROOT / "logs")
    log_level: str = "INFO"
    # Only files inside this directory can ever be removed by the clear_temp_files action.
    safe_temp_dir: str = str(AGENT_ROOT / "safe_temp")
    connectivity_hosts: list[str] = field(
        default_factory=lambda: ["1.1.1.1:53", "8.8.8.8:53", "www.microsoft.com:443"]
    )
    connectivity_check: bool = True
    enable_demo_app: bool = False
    demo_app_command: list[str] = field(
        default_factory=lambda: [sys.executable, str(AGENT_ROOT / "demo_app.py"), DEMO_MARKER]
    )
    device_type: str = "workstation"

    @property
    def api_base(self) -> str:
        return self.server_url.rstrip("/") + "/api"

    def capabilities(self) -> dict:
        from .actions import ACTIONS

        return {
            "demoApp": bool(self.enable_demo_app),
            "safeTempDir": Path(self.safe_temp_dir).is_dir(),
            "actions": sorted(ACTIONS.keys()),
        }


ENV_MAP = {
    "NANOPULSE_SERVER_URL": "server_url",
    "NANOPULSE_ENROLLMENT_KEY": "enrollment_key",
    "NANOPULSE_INTERVAL": "interval_seconds",
    "NANOPULSE_SAFE_TEMP_DIR": "safe_temp_dir",
    "NANOPULSE_LOG_LEVEL": "log_level",
}


def _coerce(name: str, value):
    types = {f.name: f.type for f in fields(AgentConfig)}
    t = str(types.get(name))
    if "float" in t:
        return float(value)
    if "int" in t:
        return int(value)
    if "bool" in t and isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="nanopulse-agent", description="NanoPulse endpoint monitoring agent")
    p.add_argument("--config", help="Path to a JSON config file (default: agent/config.json if present)")
    p.add_argument("--server-url", dest="server_url")
    p.add_argument("--enrollment-key", dest="enrollment_key", help="Required for first registration")
    p.add_argument("--interval", dest="interval_seconds", type=float, help="Telemetry interval in seconds (default 10)")
    p.add_argument("--safe-temp-dir", dest="safe_temp_dir")
    p.add_argument("--enable-demo-app", dest="enable_demo_app", action="store_true", default=None,
                   help="Allow the restart_demo_app action for demo_app.py")
    p.add_argument("--no-connectivity-check", dest="connectivity_check", action="store_false", default=None)
    p.add_argument("--log-level", dest="log_level")
    p.add_argument("--re-register", action="store_true", help="Discard saved credentials and enroll again")
    p.add_argument("--once", action="store_true", help="Collect one sample, print it as JSON and exit (no server needed)")
    return p


def load_config(argv: list[str] | None = None) -> tuple[AgentConfig, argparse.Namespace]:
    args = build_parser().parse_args(argv)
    cfg = AgentConfig()

    config_path = Path(args.config) if args.config else AGENT_ROOT / "config.json"
    if config_path.exists():
        data = json.loads(config_path.read_text(encoding="utf-8"))
        known = {f.name for f in fields(AgentConfig)}
        for key, value in data.items():
            if key in known:
                setattr(cfg, key, value)

    for env_name, attr in ENV_MAP.items():
        if os.environ.get(env_name):
            setattr(cfg, attr, _coerce(attr, os.environ[env_name]))

    for f in fields(AgentConfig):
        value = getattr(args, f.name, None)
        if value is not None:
            setattr(cfg, f.name, value)

    if cfg.interval_seconds < 2:
        raise SystemExit("interval must be at least 2 seconds")
    return cfg, args
