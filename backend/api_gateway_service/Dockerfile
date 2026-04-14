FROM python:3.11-slim
WORKDIR /app
COPY api_gateway_service/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ shared/
COPY api_gateway_service/ .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8021"]
