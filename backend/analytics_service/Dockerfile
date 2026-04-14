FROM python:3.12.9-slim

WORKDIR /app

COPY analytics_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY analytics_service/ .

EXPOSE 8015

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8015"]
