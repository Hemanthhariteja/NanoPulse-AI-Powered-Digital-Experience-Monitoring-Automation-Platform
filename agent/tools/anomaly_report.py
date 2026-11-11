"""Optional: unsupervised anomaly report for one device using scikit-learn's IsolationForest.

This is an *additional* analysis module. It is not part of the incident pipeline, which
uses deterministic, explainable rules. It pulls stored telemetry from the API and flags
samples whose CPU/RAM/disk/network combination is unusual relative to the device's own history.

    pip install scikit-learn
    python tools/anomaly_report.py --email admin@nanopulse.local --device <deviceId>
    (password is read from NANOPULSE_PASSWORD or prompted)
"""

import argparse
import getpass
import os
import sys

import requests


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--server-url", default=os.environ.get("NANOPULSE_SERVER_URL", "http://localhost:5000"))
    p.add_argument("--email", required=True)
    p.add_argument("--device", required=True, help="deviceId")
    p.add_argument("--samples", type=int, default=500)
    p.add_argument("--contamination", type=float, default=0.05)
    args = p.parse_args()

    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
    except ImportError:
        print("scikit-learn is not installed: pip install scikit-learn", file=sys.stderr)
        return 2

    api = args.server_url.rstrip("/") + "/api"
    password = os.environ.get("NANOPULSE_PASSWORD") or getpass.getpass("Password: ")
    login = requests.post(f"{api}/auth/login", json={"email": args.email, "password": password}, timeout=10)
    login.raise_for_status()
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    resp = requests.get(f"{api}/telemetry/{args.device}", params={"limit": args.samples}, headers=headers, timeout=20)
    resp.raise_for_status()
    rows = resp.json()["data"]
    if len(rows) < 30:
        print(f"Need at least 30 samples, got {len(rows)}")
        return 1

    features = ["cpuUsage", "ramUsage", "diskUsage", "networkUpload", "networkDownload"]
    X = np.array([[r.get(f, 0) or 0 for f in features] for r in rows], dtype=float)
    X[:, 3:] = np.log1p(X[:, 3:])  # network rates are heavy-tailed
    model = IsolationForest(contamination=args.contamination, random_state=42).fit(X)
    scores = model.decision_function(X)
    flagged = [(rows[i], scores[i]) for i in np.where(model.predict(X) == -1)[0]]

    print(f"Analysed {len(rows)} samples; {len(flagged)} flagged as anomalous (contamination={args.contamination})")
    means = X.mean(axis=0)
    for row, score in sorted(flagged, key=lambda x: x[1])[:20]:
        deltas = {f: round((row.get(f, 0) or 0), 1) for f in features[:3]}
        print(f"  {row['timestamp']}  score={score:.3f}  cpu={deltas['cpuUsage']} ram={deltas['ramUsage']} "
              f"disk={deltas['diskUsage']}  (fleet-of-one mean cpu={means[0]:.1f} ram={means[1]:.1f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
