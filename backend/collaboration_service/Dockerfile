FROM python:3.11-slim
WORKDIR /app
COPY collaboration_service/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ shared/
COPY collaboration_service/ .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8020"]
