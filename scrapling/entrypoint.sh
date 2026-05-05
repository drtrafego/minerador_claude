#!/bin/sh
if [ ! -f "$HOME/.cache/camoufox/version.json" ]; then
    echo "[entrypoint] Camoufox nao encontrado, instalando..."
    python -m camoufox fetch
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
