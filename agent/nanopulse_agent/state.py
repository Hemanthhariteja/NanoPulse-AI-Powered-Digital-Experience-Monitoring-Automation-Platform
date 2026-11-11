"""Persists the device identity and secret issued at registration."""

from __future__ import annotations

import json
import os
from pathlib import Path


class CredentialStore:
    def __init__(self, state_dir: str):
        self.path = Path(state_dir) / "credentials.json"

    def load(self) -> dict | None:
        if not self.path.exists():
            return None
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if data.get("deviceId") and data.get("deviceSecret"):
            return data
        return None

    def save(self, device_id: str, secret: str, server_url: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"deviceId": device_id, "deviceSecret": secret, "serverUrl": server_url}, indent=2),
                       encoding="utf-8")
        if os.name != "nt":
            os.chmod(tmp, 0o600)
        tmp.replace(self.path)

    def device_id(self) -> str | None:
        data = self.load()
        return data["deviceId"] if data else None

    def clear(self) -> None:
        if self.path.exists():
            self.path.unlink()
