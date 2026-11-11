from unittest import mock

import pytest

from nanopulse_agent.agent import Agent
from nanopulse_agent.client import ApiError, AuthError
from nanopulse_agent.config import AgentConfig, load_config
from nanopulse_agent.state import CredentialStore

SAMPLE = {"cpuUsage": 10.0, "ramUsage": 20.0, "diskUsage": 30.0, "networkConnected": True}


def make_agent(tmp_path, **cfg):
    config = AgentConfig(state_dir=str(tmp_path), enrollment_key=cfg.pop("enrollment_key", "key-123"), **cfg)
    client = mock.Mock()
    collector = mock.Mock()
    collector.collect.return_value = dict(SAMPLE)
    return Agent(config, client=client, collector=collector, store=CredentialStore(str(tmp_path))), client


def test_registers_and_persists_credentials(tmp_path):
    agent, client = make_agent(tmp_path)
    client.register.return_value = {"deviceId": "d-1", "deviceSecret": "s-1", "telemetryIntervalSeconds": 15}
    agent.ensure_registered()
    payload = client.register.call_args[0][0]
    assert payload["enrollmentKey"] == "key-123" and payload["hostname"]
    assert "capabilities" in payload
    assert CredentialStore(str(tmp_path)).load()["deviceSecret"] == "s-1"
    client.set_credentials.assert_called_with("d-1", "s-1")
    assert agent.interval == 15


def test_reuses_saved_credentials(tmp_path):
    CredentialStore(str(tmp_path)).save("d-9", "s-9", "http://x")
    agent, client = make_agent(tmp_path)
    agent.ensure_registered()
    client.register.assert_not_called()
    client.set_credentials.assert_called_with("d-9", "s-9")


def test_missing_enrollment_key_exits_with_message(tmp_path):
    agent, _ = make_agent(tmp_path, enrollment_key=None)
    with pytest.raises(SystemExit, match="enrollment-key"):
        agent.ensure_registered()


def test_reregisters_when_server_rejects_credentials(tmp_path):
    CredentialStore(str(tmp_path)).save("d-1", "old", "http://x")
    agent, client = make_agent(tmp_path)
    client.send_telemetry.side_effect = [AuthError("Invalid device credentials", 401), {"status": "HEALTHY"}]
    client.register.return_value = {"deviceId": "d-1", "deviceSecret": "new"}
    assert agent.telemetry_once() == {"status": "HEALTHY"}
    assert client.register.call_args[0][0]["deviceId"] == "d-1"  # keeps identity on re-enrollment


def test_telemetry_loop_survives_failures_and_stops(tmp_path):
    agent, client = make_agent(tmp_path, interval_seconds=2)
    calls = {"n": 0}

    def send(_sample):
        calls["n"] += 1
        if calls["n"] >= 3:
            agent.stop_event.set()
        raise ApiError("server down")

    client.send_telemetry.side_effect = send
    agent.stop_event.wait = lambda timeout=None: agent.stop_event.is_set()  # no real sleeping
    agent.telemetry_loop()
    assert calls["n"] == 3 and agent.consecutive_failures == 3


def test_cli_overrides_config(tmp_path, monkeypatch):
    monkeypatch.setenv("NANOPULSE_SERVER_URL", "http://env:5000")
    cfg, _ = load_config(["--config", str(tmp_path / "none.json"), "--interval", "30"])
    assert cfg.server_url == "http://env:5000" and cfg.interval_seconds == 30
    assert cfg.api_base == "http://env:5000/api"
