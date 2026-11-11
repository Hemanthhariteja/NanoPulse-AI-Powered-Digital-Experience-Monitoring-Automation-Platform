import os
import time
from pathlib import Path
from unittest import mock

import pytest

from nanopulse_agent import actions
from nanopulse_agent.actions import ActionContext, ActionError, resolve_safe_dir, run_action
from nanopulse_agent.config import AgentConfig


@pytest.fixture
def safe_dir(tmp_path):
    d = tmp_path / "agent" / "safe_temp"
    (d / "sub").mkdir(parents=True)
    old = time.time() - 48 * 3600
    for name in ("a.tmp", "sub/b.tmp"):
        f = d / name
        f.write_bytes(b"x" * 1024)
        os.utime(f, (old, old))
    (d / "recent.tmp").write_bytes(b"y" * 10)
    return d


def ctx_for(**kwargs):
    return ActionContext(AgentConfig(**kwargs))


def test_unknown_action_is_rejected():
    r = run_action({"actionType": "rm_rf", "parameters": {}}, ctx_for())
    assert r["status"] == "FAILED" and "Unknown action" in r["error"]


def test_shell_like_parameters_are_rejected():
    r = run_action({"actionType": "check_network_connectivity", "parameters": {"command": "format c:"}}, ctx_for())
    assert r["status"] == "FAILED" and "Unexpected parameters" in r["error"]


def test_invalid_limit_is_rejected():
    r = run_action({"actionType": "list_top_memory_processes", "parameters": {"limit": 999}}, ctx_for())
    assert r["status"] == "FAILED" and "between 1 and 25" in r["error"]


def test_list_top_memory_processes_returns_real_data():
    r = run_action({"actionType": "list_top_memory_processes", "parameters": {"limit": 3}}, ctx_for())
    assert r["status"] == "SUCCEEDED" and r["mode"] == "REAL"
    assert 1 <= len(r["data"]["processes"]) <= 3
    assert "ramUsage" in r["verification"]


def test_clear_temp_deletes_only_old_files_inside_safe_dir(safe_dir, tmp_path):
    outside = tmp_path / "important.docx"
    outside.write_bytes(b"keep")
    old = time.time() - 72 * 3600
    os.utime(outside, (old, old))

    r = run_action({"actionType": "clear_temp_files", "parameters": {"olderThanHours": 24}},
                   ctx_for(safe_temp_dir=str(safe_dir)))
    assert r["status"] == "SUCCEEDED"
    assert r["data"]["filesDeleted"] == 2 and r["data"]["bytesFreed"] == 2048
    assert not (safe_dir / "a.tmp").exists() and not (safe_dir / "sub" / "b.tmp").exists()
    assert (safe_dir / "recent.tmp").exists()
    assert outside.exists()


def test_clear_temp_dry_run_deletes_nothing(safe_dir):
    r = run_action({"actionType": "clear_temp_files", "parameters": {"olderThanHours": 24, "dryRun": True}},
                   ctx_for(safe_temp_dir=str(safe_dir)))
    assert r["status"] == "SUCCEEDED" and r["data"]["candidates"] == 2 and r["data"]["filesDeleted"] == 0
    assert (safe_dir / "a.tmp").exists()


def test_clear_temp_refuses_home_directory():
    with pytest.raises(ActionError, match="protected"):
        resolve_safe_dir(str(Path.home()))
    r = run_action({"actionType": "clear_temp_files", "parameters": {}}, ctx_for(safe_temp_dir=str(Path.home())))
    assert r["status"] == "FAILED"


def test_clear_temp_refuses_missing_directory(tmp_path):
    r = run_action({"actionType": "clear_temp_files", "parameters": {}},
                   ctx_for(safe_temp_dir=str(tmp_path / "nope" / "missing")))
    assert r["status"] == "FAILED" and "does not exist" in r["error"]


def test_restart_demo_app_requires_opt_in():
    r = run_action({"actionType": "restart_demo_app", "parameters": {}}, ctx_for(enable_demo_app=False))
    assert r["status"] == "FAILED" and "not enabled" in r["error"]


def test_restart_demo_app_refuses_arbitrary_command():
    r = run_action({"actionType": "restart_demo_app", "parameters": {}},
                   ctx_for(enable_demo_app=True, demo_app_command=["notepad.exe"]))
    assert r["status"] == "FAILED" and "demo_app.py" in r["error"]


def test_action_timeout_is_reported():
    def slow(params, ctx):
        time.sleep(2)
        return {"status": "SUCCEEDED", "summary": "late"}

    with mock.patch.dict(actions.ACTIONS, {"network_diagnostics": slow}):
        r = run_action({"actionType": "network_diagnostics", "parameters": {}}, ctx_for(), timeout=0.2)
    assert r["status"] == "FAILED" and "timed out" in r["summary"]


def test_crashing_action_is_reported_not_raised():
    def boom(params, ctx):
        raise RuntimeError("kaput")

    with mock.patch.dict(actions.ACTIONS, {"network_diagnostics": boom}):
        r = run_action({"actionType": "network_diagnostics", "parameters": {}}, ctx_for())
    assert r["status"] == "FAILED" and "kaput" in r["error"]
