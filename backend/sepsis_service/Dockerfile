FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Data directory (XES cached here at runtime)
RUN mkdir -p /app/data

EXPOSE 8023
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8023"]
