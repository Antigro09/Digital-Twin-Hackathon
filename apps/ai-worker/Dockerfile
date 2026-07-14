FROM python:3.12.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONHASHSEED=0

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "edt_ai_worker.api:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
