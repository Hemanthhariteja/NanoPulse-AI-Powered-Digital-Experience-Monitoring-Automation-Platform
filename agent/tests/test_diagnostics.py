from nanopulse_agent.diagnostics import evaluate, health_status, severity_for


def test_severity_boundaries_match_server_rules():
    assert severity_for(69.9, 70, 85) is None
    assert severity_for(70, 70, 85) == "WARNING"
    assert severity_for(85, 70, 85) == "WARNING"
    assert severity_for(85.1, 70, 85) == "CRITICAL"
    assert severity_for(None, 70, 85) is None


def test_evaluate_healthy_sample():
    findings = evaluate({"cpuUsage": 20, "ramUsage": 40, "diskUsage": 50, "networkConnected": True})
    assert findings == []
    assert health_status(findings) == "HEALTHY"


def test_evaluate_detects_each_resource():
    findings = evaluate({"cpuUsage": 90, "ramUsage": 80, "diskUsage": 95, "networkConnected": False})
    by_rule = {f["ruleId"]: f["severity"] for f in findings}
    assert by_rule == {"cpu_high": "CRITICAL", "memory_high": "WARNING", "disk_high": "CRITICAL",
                       "network_down": "CRITICAL"}
    assert health_status(findings) == "CRITICAL"


def test_custom_thresholds_override_defaults():
    findings = evaluate({"cpuUsage": 60, "ramUsage": 10, "diskUsage": 10}, {"cpuWarning": 50, "cpuCritical": 95})
    assert findings == [{"ruleId": "cpu_high", "severity": "WARNING", "value": 60}]
    assert health_status(findings) == "WARNING"
