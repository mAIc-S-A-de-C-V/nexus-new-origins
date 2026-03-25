FROM python:3.12-slim

WORKDIR /app

COPY backend/ontology_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/shared/ ./shared/
COPY backend/ontology_service/ .

EXPOSE 8004

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
