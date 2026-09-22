# Pinned to 3.12, deliberately NOT the 3.14 used for local dev in this repo
# - qiskit-aer/numpy/scipy have no prebuilt wheels for 3.14 yet, which made
# local `pip install` take ~35 minutes building from source. 3.12 has
# prebuilt wheels for the full stack, so this builds in a couple of minutes.
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run injects PORT (default 8080) and requires binding 0.0.0.0.
# QUANTUM_JOB_PROVIDER defaults to "mock" (app/config.py) unless overridden
# by the Cloud Run deploy step - no IBM credentials baked into the image.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
