"""Create harmless dummy files in the agent's safe temp directory for the clear_temp_files demo.

    python tools/seed_temp.py                 # 50 files x 1 MB, aged 48 h
    python tools/seed_temp.py --count 200 --size-kb 512 --age-hours 72
"""

import argparse
import os
import time
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default=str(AGENT_ROOT / "safe_temp"))
    p.add_argument("--count", type=int, default=50)
    p.add_argument("--size-kb", type=int, default=1024)
    p.add_argument("--age-hours", type=float, default=48)
    p.add_argument("--fresh", type=int, default=5, help="Also create N recent files that must NOT be deleted")
    args = p.parse_args()

    root = Path(args.dir)
    (root / "cache").mkdir(parents=True, exist_ok=True)
    old = time.time() - args.age_hours * 3600
    chunk = os.urandom(1024)
    for i in range(args.count):
        f = root / ("cache" if i % 2 else "") / f"np-demo-{i:04d}.tmp"
        f.write_bytes(chunk * args.size_kb)
        os.utime(f, (old, old))
    for i in range(args.fresh):
        (root / f"np-recent-{i:02d}.tmp").write_bytes(chunk)
    print(f"Seeded {args.count} aged files ({args.count * args.size_kb / 1024:.1f} MB) and {args.fresh} recent files in {root}")


if __name__ == "__main__":
    main()
