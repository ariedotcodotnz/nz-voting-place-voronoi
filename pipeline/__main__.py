"""Command-line entry point.

    python -m pipeline build            # regenerate public/data + reports/
    python -m pipeline build --no-geometry
    python -m pipeline validate         # integrity checks on the generated assets
    python -m pipeline labels           # refresh map labels only
"""

from __future__ import annotations

import argparse
import sys


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="rebuild all processed election datasets")
    b.add_argument("--no-geometry", action="store_true", help="skip catchment generation (results only)")
    sub.add_parser("validate", help="validate generated assets in public/data")
    sub.add_parser("labels", help="rebuild map place-name labels from the generated results (fast)")
    args = ap.parse_args()
    if args.cmd == "build":
        from .build import run
        from .validate import validate_outputs

        summary = run(skip_geometry=args.no_geometry)
        print(f"Source-data issues: {summary['errors']} errors, {summary['warnings']} warnings (see reports/processing-report.md)")
        problems = validate_outputs(require_geometry=not args.no_geometry)
        for p in problems:
            print("VALIDATION FAILED:", p, file=sys.stderr)
        return 1 if problems else 0
    if args.cmd == "labels":
        from .common import OUT_DIR
        from .labels import update_labels

        print("Wrote", update_labels(OUT_DIR))
        return 0
    if args.cmd == "validate":
        from .validate import validate_outputs

        problems = validate_outputs()
        for p in problems:
            print("VALIDATION FAILED:", p, file=sys.stderr)
        print("OK" if not problems else f"{len(problems)} problems")
        return 1 if problems else 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
