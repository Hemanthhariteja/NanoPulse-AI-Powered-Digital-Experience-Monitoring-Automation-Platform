from unittest import mock

import pytest
import requests

from nanopulse_agent.client import ApiClient, ApiError, AuthError


def response(status, body=None):
    r = mock.Mock(spec=requests.Response)
    r.status_code = status
    r.content = b"{}" if body is not None else b""
    r.json.return_value = body if body is not None else {}
    return r


def make_client(responses, retries=3):
    session = mock.Mock(spec=requests.Session)
    session.headers = {}
    session.request.side_effect = responses
    sleeps = []
    c = ApiClient("http://server/api", max_retries=retries, session=session, sleep=sleeps.append)
    c.set_credentials("dev-1", "secret-1")
    return c, session, sleeps


def test_sends_device_credentials_and_timeout():
    c, session, _ = make_client([response(202, {"status": "HEALTHY"})])
    assert c.send_telemetry({"cpuUsage": 1}) == {"status": "HEALTHY"}
    _, kwargs = session.request.call_args
    assert kwargs["headers"] == {"X-Device-Id": "dev-1", "X-Device-Secret": "secret-1"}
    assert kwargs["timeout"] == c.timeout


def test_retries_connection_errors_with_backoff_then_succeeds():
    c, session, sleeps = make_client([requests.ConnectionError("down"), requests.Timeout("slow"), response(202, {"ok": 1})])
    assert c.send_telemetry({}) == {"ok": 1}
    assert session.request.call_count == 3
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0] * 1.1  # exponential growth (with jitter)


def test_retries_5xx_and_raises_after_exhausting_attempts():
    c, session, sleeps = make_client([response(503, {"error": {"message": "unavailable"}})] * 3, retries=2)
    with pytest.raises(ApiError) as exc:
        c.send_telemetry({})
    assert exc.value.status == 503
    assert session.request.call_count == 3
    assert len(sleeps) == 2


def test_401_raises_auth_error_without_retry():
    c, session, sleeps = make_client([response(401, {"error": {"message": "Invalid device credentials"}})])
    with pytest.raises(AuthError, match="Invalid device credentials"):
        c.send_telemetry({})
    assert session.request.call_count == 1 and sleeps == []


def test_4xx_is_not_retried():
    c, session, _ = make_client([response(400, {"error": {"message": "bad"}})])
    with pytest.raises(ApiError) as exc:
        c.send_telemetry({})
    assert exc.value.status == 400 and session.request.call_count == 1


def test_unregistered_client_refuses_authenticated_calls():
    c = ApiClient("http://server/api", session=mock.Mock(spec=requests.Session, headers={}))
    with pytest.raises(AuthError):
        c.send_telemetry({})


def test_register_does_not_send_device_headers():
    c, session, _ = make_client([response(201, {"deviceId": "x", "deviceSecret": "y"})])
    c.register({"enrollmentKey": "k"})
    _, kwargs = session.request.call_args
    assert kwargs["headers"] == {}
