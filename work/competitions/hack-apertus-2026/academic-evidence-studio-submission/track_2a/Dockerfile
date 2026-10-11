FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./
COPY prepare_dev.py evaluate_dev.py ./
COPY src/ ./src/

RUN useradd --create-home --uid 10001 solution
USER solution

ENTRYPOINT ["python", "/app/main.py"]
