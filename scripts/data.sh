#!/usr/bin/env sh
# Run the Python data pipeline, preferring the project virtualenv.
#   sh scripts/data.sh build      rebuild public/data and reports/
#   sh scripts/data.sh validate   check generated assets
#   sh scripts/data.sh test       run the pipeline tests (pytest)
set -e
cd "$(dirname "$0")/.."
# Windows virtualenvs keep python in Scripts/, and Windows has "python" (its
# "python3" is usually only the Microsoft Store installer stub).
if [ -x .venv/bin/python ]; then PY=.venv/bin/python
elif [ -x .venv/Scripts/python.exe ]; then PY=.venv/Scripts/python.exe
elif command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then PY=python3
else PY=python
fi
if [ "$1" = "test" ]; then
  shift
  exec "$PY" -m pytest -q tests/python "$@"
fi
exec "$PY" -m pipeline "${@:-build}"
