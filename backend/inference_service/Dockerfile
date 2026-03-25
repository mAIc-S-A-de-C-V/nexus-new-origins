FROM python:3.12-slim

WORKDIR /app

COPY backend/inference_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/shared/ ./shared/
COPY backend/inference_service/ .

EXPOSE 8003

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003"]
