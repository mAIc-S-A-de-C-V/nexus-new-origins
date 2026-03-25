FROM python:3.12-slim

WORKDIR /app

COPY backend/pipeline_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/shared/ ./shared/
COPY backend/pipeline_service/ .

EXPOSE 8002

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
