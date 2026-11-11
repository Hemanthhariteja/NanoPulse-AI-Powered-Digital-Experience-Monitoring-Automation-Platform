"""Entry point: python -m nanopulse_agent [options]"""

from __future__ import annotations

import json
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .agent import Agent
from .collector import MetricsCollector, host_info
from .config import load_config


def setup_logging(log_dir: str, level: str) -> None:
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(level.upper())
    file_handler = RotatingFileHandler(Path(log_dir) / "agent.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    file_handler.setFormatter(fmt)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # never crash logging on a legacy console codepage
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    root.handlers = [file_handler, console]


def main(argv: list[str] | None = None) -> int:
    cfg, args = load_config(argv)
    if args.once:
        import time

        collector = MetricsCollector(cfg.process_limit, cfg.connectivity_hosts, cfg.connectivity_check, cfg.server_url)
        time.sleep(1)  # give cpu_percent a measurement window
        print(json.dumps({"host": host_info(cfg.server_url), "sample": collector.collect()}, indent=2))
        return 0
    setup_logging(cfg.log_dir, cfg.log_level)
    Path(cfg.safe_temp_dir).mkdir(parents=True, exist_ok=True)
    Agent(cfg).run(force_register=args.re_register)
    return 0


if __name__ == "__main__":
    sys.exit(main())
