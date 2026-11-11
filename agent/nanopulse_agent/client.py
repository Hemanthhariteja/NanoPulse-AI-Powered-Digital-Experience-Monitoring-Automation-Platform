"""HTTP client for the NanoPulse API with timeouts and exponential-backoff retries."""

from __future__ import annotations

import logging
import random
import time

import requests

log = logging.getLogger("nanopulse.client")

RETRYABLE_STATUS = {429, 500, 502, 503, 504}


class ApiError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class AuthError(ApiError):
    """Credentials were rejected (401). The agent may need to re-register."""


class ApiClient:
    def __init__(self, base_url: str, timeout: float = 10.0, max_retries: int = 3,
                 backoff_base: float = 1.0, backoff_max: float = 30.0, session: requests.Session | None = None,
                 sleep=time.sleep):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max
        self.session = session or requests.Session()
        self.session.headers.update({"User-Agent": "nanopulse-agent/1.0", "Accept": "application/json"})
        self.device_id: str | None = None
        self.device_secret: str | None = None
        self._sleep = sleep

    def set_credentials(self, device_id: str, secret: str) -> None:
        self.device_id, self.device_secret = device_id, secret

    def _backoff(self, attempt: int) -> float:
        delay = min(self.backoff_max, self.backoff_base * (2 ** attempt))
        return delay * (0.75 + random.random() * 0.5)  # ±25 % jitter

    def request(self, method: str, path: str, json=None, auth: bool = True, retries: int | None = None):
        url = f"{self.base_url}{path}"
        headers = {}
        if auth:
            if not self.device_id or not self.device_secret:
                raise AuthError("Agent is not registered")
            headers = {"X-Device-Id": self.device_id, "X-Device-Secret": self.device_secret}

        attempts = (self.max_retries if retries is None else retries) + 1
        last_error: Exception | None = None
        for attempt in range(attempts):
            try:
                resp = self.session.request(method, url, json=json, headers=headers, timeout=self.timeout)
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_error = ApiError(f"{type(exc).__name__}: {exc}")
                log.warning("Request %s %s failed (%s), attempt %d/%d", method, path, type(exc).__name__,
                            attempt + 1, attempts)
            else:
                if resp.status_code == 401:
                    raise AuthError(_message(resp), 401)
                if resp.status_code in RETRYABLE_STATUS:
                    last_error = ApiError(_message(resp), resp.status_code)
                    log.warning("Request %s %s returned %d, attempt %d/%d", method, path, resp.status_code,
                                attempt + 1, attempts)
                elif resp.status_code >= 400:
                    raise ApiError(_message(resp), resp.status_code)
                else:
                    return resp.json() if resp.content else None
            if attempt < attempts - 1:
                self._sleep(self._backoff(attempt))
        raise last_error or ApiError("Request failed")

    # ---- API calls ------------------------------------------------------------
    def register(self, payload: dict) -> dict:
        return self.request("POST", "/devices/register", json=payload, auth=False)

    def send_telemetry(self, sample: dict) -> dict:
        return self.request("POST", "/telemetry", json=sample)

    def get_config(self) -> dict:
        return self.request("GET", "/agent/config")

    def poll_commands(self) -> list[dict]:
        return (self.request("GET", "/agent/commands", retries=0) or {}).get("commands", [])

    def submit_result(self, action_id: str, result: dict) -> dict:
        return self.request("POST", f"/agent/commands/{action_id}/result", json=result, retries=5)

    def shutdown(self) -> None:
        self.request("POST", "/agent/shutdown", retries=0)


def _message(resp: requests.Response) -> str:
    try:
        return resp.json().get("error", {}).get("message") or f"HTTP {resp.status_code}"
    except ValueError:
        return f"HTTP {resp.status_code}"
