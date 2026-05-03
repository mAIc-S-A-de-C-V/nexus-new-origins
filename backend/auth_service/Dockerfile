# Multi-stage build — keeps the runtime image small (less disk pressure on
# EC2 during pull/extract) and isolates pip's temp scratch from the final
# layer. Net win: ~250MB lighter image vs. a single-stage build, which is
# the difference between succeeding and failing on a near-full host.
FROM python:3.11.11-slim AS builder

WORKDIR /build

# bcrypt + cryptography need a C toolchain to wheel-build on slim. We drop
# all of this in stage 2 so it never ships in the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install into a self-contained venv we copy into the runtime stage.
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt


FROM python:3.11.11-slim

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY . .

EXPOSE 8011
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8011", "--reload"]
