"""Agent runtime: registration, telemetry loop, command loop and graceful shutdown."""

from __future__ import annotations

import logging
import signal
import threading
import time

from . import __version__
from .actions import ActionContext, run_action
from .client import ApiClient, ApiError, AuthError
from .collector import MetricsCollector, host_info
from .config import AgentConfig
from .diagnostics import evaluate, health_status
from .state import CredentialStore

log = logging.getLogger("nanopulse.agent")


class Agent:
    def __init__(self, config: AgentConfig, client: ApiClient | None = None,
                 collector: MetricsCollector | None = None, store: CredentialStore | None = None):
        self.config = config
        self.client = client or ApiClient(config.api_base, timeout=config.request_timeout_seconds,
                                          max_retries=config.max_retries)
        self.collector = collector or MetricsCollector(config.process_limit, config.connectivity_hosts,
                                                       config.connectivity_check, config.server_url)
        self.store = store or CredentialStore(config.state_dir)
        self.stop_event = threading.Event()
        self.thresholds: dict = {}
        self.interval = config.interval_seconds
        self.consecutive_failures = 0

    # ---- registration -----------------------------------------------------------
    def ensure_registered(self, force: bool = False) -> None:
        creds = None if force else self.store.load()
        if creds:
            self.client.set_credentials(creds["deviceId"], creds["deviceSecret"])
            log.info("Using saved device identity %s", creds["deviceId"])
            return
        self.register()

    def register(self) -> None:
        if not self.config.enrollment_key:
            raise SystemExit("No saved credentials. Provide --enrollment-key (Settings -> Agent setup in the dashboard).")
        payload = {
            **{k: v for k, v in host_info(self.config.server_url).items() if v},
            "enrollmentKey": self.config.enrollment_key,
            "deviceType": self.config.device_type,
            "agentVersion": __version__,
            "capabilities": self.config.capabilities(),
        }
        previous = self.store.device_id()
        if previous:
            payload["deviceId"] = previous
        result = self.client.register(payload)
        self.store.save(result["deviceId"], result["deviceSecret"], self.config.server_url)
        self.client.set_credentials(result["deviceId"], result["deviceSecret"])
        if result.get("telemetryIntervalSeconds") and not self._interval_overridden():
            self.interval = float(result["telemetryIntervalSeconds"])
        log.info("Registered as device %s (%s)", result["deviceId"], "re-enrolled" if result.get("reenrolled") else "new")

    def _interval_overridden(self) -> bool:
        return self.config.interval_seconds != AgentConfig().interval_seconds

    def refresh_config(self) -> None:
        try:
            cfg = self.client.get_config()
            self.thresholds = cfg.get("thresholds", {})
            if cfg.get("telemetryIntervalSeconds") and not self._interval_overridden():
                self.interval = float(cfg["telemetryIntervalSeconds"])
        except ApiError as exc:
            log.warning("Could not fetch agent config: %s", exc)

    # ---- loops --------------------------------------------------------------------
    def telemetry_once(self) -> dict | None:
        sample = self.collector.collect()
        local = evaluate(sample, self.thresholds)
        if local:
            log.warning("Local assessment %s: %s", health_status(local),
                        ", ".join(f"{f['ruleId']}={f['value']}" for f in local))
        try:
            result = self.client.send_telemetry(sample)
        except AuthError:
            log.error("Server rejected device credentials; attempting re-registration")
            self.register()
            result = self.client.send_telemetry(sample)
        self.consecutive_failures = 0
        log.info("Telemetry sent: cpu=%.1f%% ram=%.1f%% disk=%.1f%% -> server status %s",
                 sample["cpuUsage"], sample["ramUsage"], sample["diskUsage"], (result or {}).get("status"))
        return result

    def telemetry_loop(self) -> None:
        while not self.stop_event.is_set():
            started = time.monotonic()
            try:
                self.telemetry_once()
            except (ApiError, SystemExit) as exc:
                self.consecutive_failures += 1
                log.error("Telemetry delivery failed (%d in a row): %s", self.consecutive_failures, exc)
            except Exception:  # noqa: BLE001 — never let the loop die
                self.consecutive_failures += 1
                log.exception("Unexpected error while collecting telemetry")
            # Back off when the server keeps failing, up to 6× the interval.
            wait = self.interval * min(6, 1 + self.consecutive_failures // 3)
            self.stop_event.wait(max(0.5, wait - (time.monotonic() - started)))

    def command_loop(self) -> None:
        ctx = ActionContext(self.config)
        while not self.stop_event.is_set():
            try:
                for command in self.client.poll_commands():
                    log.info("Executing approved action %s (%s)", command["actionId"], command["actionType"])
                    result = run_action(command, ctx)
                    log.info("Action %s %s: %s", command["actionId"], result["status"], result["summary"])
                    self.client.submit_result(command["actionId"], result)
            except AuthError as exc:
                log.warning("Command poll unauthorized: %s", exc)
            except ApiError as exc:
                log.debug("Command poll failed: %s", exc)
            except Exception:  # noqa: BLE001
                log.exception("Unexpected error in command loop")
            self.stop_event.wait(self.config.command_poll_seconds)

    # ---- lifecycle ------------------------------------------------------------------
    def install_signal_handlers(self) -> None:
        def handler(signum, _frame):
            log.info("Received signal %s, stopping", signum)
            self.stop_event.set()

        signal.signal(signal.SIGINT, handler)
        signal.signal(signal.SIGTERM, handler)
        if hasattr(signal, "SIGBREAK"):
            signal.signal(signal.SIGBREAK, handler)

    def run(self, force_register: bool = False) -> None:
        self.install_signal_handlers()
        self.ensure_registered(force=force_register)
        self.refresh_config()
        log.info("Agent started: interval=%ss server=%s demo_app=%s safe_temp_dir=%s", self.interval,
                 self.config.server_url, self.config.enable_demo_app, self.config.safe_temp_dir)
        commands = threading.Thread(target=self.command_loop, name="commands", daemon=True)
        commands.start()
        try:
            self.telemetry_loop()
        finally:
            self.stop_event.set()
            commands.join(timeout=5)
            try:
                self.client.shutdown()
                log.info("Notified server of graceful shutdown")
            except ApiError as exc:
                log.warning("Could not notify server of shutdown: %s", exc)
            log.info("Agent stopped")
