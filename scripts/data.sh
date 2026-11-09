#!/usr/bin/env sh
# Run the Python data pipeline, preferring the project virtualenv.
#   sh scripts/data.sh build      rebuild public/data and reports/
#   sh scripts/data.sh validate   check generated assets
set -e
cd "$(dirname "$0")/.."
PY=python3
if [ -x .venv/bin/python ]; then PY=.venv/bin/python; fi
exec "$PY" -m pipeline "${@:-build}"
