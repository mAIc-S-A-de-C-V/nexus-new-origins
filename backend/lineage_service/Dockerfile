FROM python:3.12.9-slim
WORKDIR /app
COPY lineage_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY lineage_service/ .
EXPOSE 8017
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8017"]
