FROM python:3.12.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /tool

COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt

COPY export.py ./
COPY fixtures ./fixtures

ENTRYPOINT ["python", "/tool/export.py"]
