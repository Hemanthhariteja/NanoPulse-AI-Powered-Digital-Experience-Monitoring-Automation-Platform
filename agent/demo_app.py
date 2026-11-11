"""NanoPulse demo application — a harmless workload used to demonstrate detection and remediation.

    python demo_app.py --nanopulse-demo                 # idle (normal state)
    python demo_app.py --nanopulse-demo --burn-cpu      # one busy worker per core → high CPU
    python demo_app.py --nanopulse-demo --hold-mb 2048  # allocate memory → high RAM

The agent's restart_demo_app action stops processes carrying the --nanopulse-demo marker and
starts this script again in its idle mode, which clears the problem.
"""

import argparse
import multiprocessing as mp
import os
import signal
import sys
import time


def burn(stop_after: float) -> None:
    end = time.time() + stop_after
    x = 0
    while time.time() < end:
        x = (x * 31 + 7) % 1_000_003


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nanopulse-demo", action="store_true", required=True)
    parser.add_argument("--burn-cpu", action="store_true")
    parser.add_argument("--cores", type=int, default=os.cpu_count() or 1)
    parser.add_argument("--hold-mb", type=int, default=0)
    parser.add_argument("--duration", type=float, default=1800, help="Safety limit in seconds (default 30 min)")
    args = parser.parse_args()

    workers = []
    if args.burn_cpu:
        for _ in range(max(1, args.cores)):
            p = mp.Process(target=burn, args=(args.duration,), daemon=True)
            p.start()
            workers.append(p)
    ballast = bytearray(args.hold_mb * 1024 * 1024) if args.hold_mb > 0 else None
    if ballast:
        for i in range(0, len(ballast), 4096):  # touch pages so they count as resident memory
            ballast[i] = 1

    mode = "burn-cpu" if args.burn_cpu else ("hold-memory" if ballast else "idle")
    print(f"NanoPulse demo app running (pid {os.getpid()}, mode {mode}). Ctrl+C to stop.", flush=True)

    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.update(flag=True))
    signal.signal(signal.SIGTERM, lambda *_: stop.update(flag=True))
    start = time.time()
    while not stop["flag"] and time.time() - start < args.duration:
        time.sleep(0.5)
    for w in workers:
        w.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
