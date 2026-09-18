#!/usr/bin/env python3
"""Differential test: the TypeScript .cub parser vs the original C one.

Build the C side from a cub3D checkout with a main() that calls parse_map +
validate_map and prints ACCEPT, then:

    python3 scripts/parity-fuzz.py ./parity <cub3D-checkout> [iterations]

The checkout is needed because the C `is_valid_xpm_path` really opens the texture
files, so both parsers run with a working directory where `textures/wall_*.xpm`
exist. Any disagreement on accept/reject is a port bug and is printed in full.
"""

import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "scripts" / "parity-runner.ts"

HEADER = [
    "NO ./textures/wall_n.xpm",
    "SO ./textures/wall_s.xpm",
    "WE ./textures/wall_w.xpm",
    "EA ./textures/wall_e.xpm",
    "F 220,100,0",
    "C 225,30,0",
]


def closed_room(rng: random.Random) -> list[str]:
    w, h = rng.randint(3, 12), rng.randint(3, 10)
    grid = [["1"] * w for _ in range(h)]
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            grid[y][x] = "0"
    if w > 2 and h > 2:
        grid[rng.randint(1, h - 2)][rng.randint(1, w - 2)] = rng.choice("NSEW")
    else:
        grid[0][0] = "N"
    return ["".join(row) for row in grid]


MUTATIONS = [
    "none",
    "punch_hole",
    "extra_spawn",
    "no_spawn",
    "drop_header",
    "bad_rgb_range",
    "bad_rgb_text",
    "bad_rgb_count",
    "trailing_junk",
    "ragged_row",
    "interior_space",
    "blank_line_mid_map",
    "reorder_header",
    "indent_map",
    "comment_in_header",
    "interior_pillar",
    "tab_in_map",
    "duplicate_header",
]


def build_case(rng: random.Random) -> str:
    grid = closed_room(rng)
    header = list(HEADER)
    trailer: list[str] = []
    mutation = rng.choice(MUTATIONS)

    if mutation == "punch_hole":
        y = rng.randrange(len(grid))
        x = rng.randrange(len(grid[y]))
        row = list(grid[y])
        row[x] = "0"
        grid[y] = "".join(row)
    elif mutation == "extra_spawn":
        y = rng.randrange(len(grid))
        x = rng.randrange(len(grid[y]))
        row = list(grid[y])
        row[x] = rng.choice("NSEW")
        grid[y] = "".join(row)
    elif mutation == "no_spawn":
        grid = [row.translate(str.maketrans("NSEW", "0000")) for row in grid]
    elif mutation == "drop_header":
        header.pop(rng.randrange(len(header)))
    elif mutation == "bad_rgb_range":
        header[4] = f"F {rng.randint(256, 999)},100,0"
    elif mutation == "bad_rgb_text":
        header[4] = "F 220,abc,0"
    elif mutation == "bad_rgb_count":
        header[4] = "F 220,100"
    elif mutation == "trailing_junk":
        trailer.append(rng.choice(["eggdfgdfg", "xyz", "2"]))
    elif mutation == "ragged_row":
        y = rng.randrange(len(grid))
        if len(grid[y]) > 1:
            grid[y] = grid[y][:-1]
    elif mutation == "interior_space":
        if len(grid) > 2 and len(grid[1]) > 2:
            row = list(grid[1])
            row[1] = " "
            grid[1] = "".join(row)
    elif mutation == "blank_line_mid_map":
        grid.insert(rng.randrange(1, len(grid)), "")
    elif mutation == "reorder_header":
        rng.shuffle(header)
    elif mutation == "indent_map":
        grid = ["  " + row for row in grid]
    elif mutation == "comment_in_header":
        header.insert(rng.randrange(len(header) + 1), "# a comment")
    elif mutation == "interior_pillar":
        if len(grid) > 2 and len(grid[1]) > 2:
            row = list(grid[1])
            row[1] = "1"
            grid[1] = "".join(row)
    elif mutation == "tab_in_map":
        grid[0] = "\t" + grid[0]
    elif mutation == "duplicate_header":
        header.append(header[rng.randrange(len(header))])

    return "\n".join([*header, "", *grid, *trailer, ""])


def verdict(output: str) -> str:
    return "ACCEPT" if "ACCEPT" in output else "REJECT"


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    c_binary = Path(sys.argv[1]).resolve()
    checkout = Path(sys.argv[2]).resolve()
    iterations = int(sys.argv[3]) if len(sys.argv) > 3 else 300
    rng = random.Random(1312)

    missing = [n for n in ("n", "s", "w", "e") if not (checkout / f"textures/wall_{n}.xpm").is_file()]
    if missing:
        print(f"{checkout} is missing textures/wall_{{{','.join(missing)}}}.xpm", file=sys.stderr)
        return 2

    mismatches = 0
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "case.cub"
        for n in range(iterations):
            text = build_case(rng)
            path.write_text(text, encoding="utf-8")

            c_out = subprocess.run(
                [str(c_binary), str(path)],
                capture_output=True,
                text=True,
                timeout=10,
                cwd=checkout,
            )
            ts_out = subprocess.run(
                ["node", str(RUNNER), str(path)], capture_output=True, text=True, timeout=30
            )
            c_verdict = verdict(c_out.stdout)
            ts_verdict = verdict(ts_out.stdout)

            if c_verdict != ts_verdict:
                mismatches += 1
                print(f"\n=== mismatch #{mismatches} (case {n}) ===")
                print(f"C: {c_verdict}   TS: {ts_verdict}")
                print(f"C stdout: {c_out.stdout.strip()!r}")
                print(f"TS stderr: {ts_out.stderr.strip()[:400]!r}")
                print(text)

    print(f"\n{iterations} cases, {mismatches} mismatches")
    return 1 if mismatches else 0


if __name__ == "__main__":
    raise SystemExit(main())
