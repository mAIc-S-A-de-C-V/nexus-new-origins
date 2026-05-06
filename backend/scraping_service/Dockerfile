FROM python:3.12.9-slim

# Scrapling/lxml need libxml2/libxslt headers at build time and the runtimes after.
# Keeping the image slim — no browser binaries here. If we later want Camoufox
# stealth for JS-heavy / Cloudflare sites, swap to a base image with Firefox
# and `pip install camoufox` separately.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 libxslt1.1 libxml2-dev libxslt1-dev gcc \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY scraping_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Strip dev libs after pip is done — keeps the image ~150MB instead of 400MB.
RUN apt-get purge -y --auto-remove libxml2-dev libxslt1-dev gcc \
 && apt-get clean

COPY scraping_service/ .

EXPOSE 8027

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8027"]
