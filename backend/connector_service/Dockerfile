FROM python:3.12-slim

WORKDIR /app

COPY backend/connector_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/connector_service/ .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
