"""Local mirror of the server's threshold rules.

The authoritative diagnostic engine runs in the backend (so real and simulated endpoints
share one pipeline). The agent uses this module to self-assess each sample and log local
warnings, which is useful when the server is unreachable. Thresholds are refreshed from
GET /api/agent/config.
"""

from __future__ import annotations

DEFAULT_THRESHOLDS = {
    "cpuWarning": 70, "cpuCritical": 85,
    "ramWarning": 75, "ramCritical": 90,
    "diskWarning": 80, "diskCritical": 90,
    "networkThroughputMBps": 50,
}


def severity_for(value: float | None, warn: float, crit: float) -> str | None:
    if value is None:
        return None
    if value > crit:
        return "CRITICAL"
    if value >= warn:
        return "WARNING"
    return None


def evaluate(sample: dict, thresholds: dict | None = None) -> list[dict]:
    t = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    findings = []
    for rule, key, prefix in (("cpu_high", "cpuUsage", "cpu"), ("memory_high", "ramUsage", "ram"),
                              ("disk_high", "diskUsage", "disk")):
        sev = severity_for(sample.get(key), t[f"{prefix}Warning"], t[f"{prefix}Critical"])
        if sev:
            findings.append({"ruleId": rule, "severity": sev, "value": sample.get(key)})
    if sample.get("networkConnected") is False:
        findings.append({"ruleId": "network_down", "severity": "CRITICAL", "value": False})
    return findings


def health_status(findings: list[dict]) -> str:
    if any(f["severity"] == "CRITICAL" for f in findings):
        return "CRITICAL"
    if any(f["severity"] == "WARNING" for f in findings):
        return "WARNING"
    return "HEALTHY"
