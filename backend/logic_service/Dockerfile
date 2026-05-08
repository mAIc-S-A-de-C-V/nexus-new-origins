FROM python:3.12.9-slim
WORKDIR /app
COPY logic_service/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ shared/
COPY logic_service/ .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8012"]
