from collections import namedtuple
from unittest import mock

from nanopulse_agent import collector as col
from nanopulse_agent.collector import MetricsCollector

REQUIRED = {
    "cpuUsage", "cpuCount", "ramUsage", "ramTotalBytes", "ramAvailableBytes", "diskUsage", "diskTotalBytes",
    "diskFreeBytes", "networkUpload", "networkDownload", "networkConnected", "uptimeSeconds", "processes", "interfaces",
}


def test_collect_returns_real_metrics_in_valid_ranges():
    c = MetricsCollector(process_limit=5, connectivity_check=False)
    sample = c.collect()
    assert REQUIRED <= sample.keys()
    for key in ("cpuUsage", "ramUsage", "diskUsage"):
        assert 0 <= sample[key] <= 100
    assert sample["ramTotalBytes"] > 0 and sample["diskTotalBytes"] > 0
    assert sample["uptimeSeconds"] > 0
    assert sample["networkConnected"] is True  # check disabled
    assert len(sample["processes"]) <= 5
    for p in sample["processes"]:
        assert p["pid"] != 0
        assert 0 <= p["cpuPercent"] <= 100
        assert set(p) >= {"pid", "name", "cpuPercent", "memoryPercent", "memoryBytes"}


def test_collect_contains_no_personal_data_fields():
    sample = MetricsCollector(process_limit=3, connectivity_check=False).collect()
    flat = str(sample).lower()
    for forbidden in ("password", "history", "keystroke", "cookie", "cmdline", "username"):
        assert forbidden not in flat


def test_network_rates_are_computed_from_counter_deltas():
    Io = namedtuple("Io", "bytes_sent bytes_recv")
    c = MetricsCollector(process_limit=1, connectivity_check=False)
    times = iter([100.0, 102.0])
    counters = iter([Io(1000, 5000), Io(3000, 9000)])
    with mock.patch.object(col.time, "monotonic", lambda: next(times)), \
         mock.patch.object(col.psutil, "net_io_counters", lambda: next(counters)):
        c._last_net = None
        first = c.network()
        second = c.network()
    assert first["networkUpload"] == 0 and first["networkDownload"] == 0
    assert second["networkUpload"] == 1000  # 2000 bytes / 2 s
    assert second["networkDownload"] == 2000


def test_connectivity_true_if_any_probe_succeeds():
    c = MetricsCollector(process_limit=1, connectivity_hosts=["a:1", "b:2"])
    with mock.patch.object(col, "tcp_probe", side_effect=[(False, None, "x"), (True, 5.0, None)]):
        assert c.connectivity() is True
    with mock.patch.object(col, "tcp_probe", return_value=(False, None, "timeout")):
        assert c.connectivity() is False


def test_tcp_probe_handles_invalid_target():
    ok, latency, err = col.tcp_probe("not-a-valid-target", timeout=0.1)
    assert ok is False and latency is None and err


def test_host_info_has_identity_fields():
    info = col.host_info()
    assert info["hostname"] and info["operatingSystem"]
