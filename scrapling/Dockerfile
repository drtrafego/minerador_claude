FROM mcr.microsoft.com/playwright/python:v1.47.0-jammy

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CAMOUFOX_PATH=/root/.cache/camoufox

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt && \
    python -m camoufox fetch && \
    python -m playwright install chromium

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
