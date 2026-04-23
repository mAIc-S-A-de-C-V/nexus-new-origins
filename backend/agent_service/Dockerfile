FROM python:3.12.9-slim
WORKDIR /app
COPY agent_service/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ shared/
COPY agent_service/ .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8013"]
