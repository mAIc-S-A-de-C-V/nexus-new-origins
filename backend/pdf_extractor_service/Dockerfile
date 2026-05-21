FROM python:3.12.9-slim

WORKDIR /app

COPY pdf_extractor_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY shared/ ./shared/
COPY pdf_extractor_service/ .

EXPOSE 8033

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8033"]
