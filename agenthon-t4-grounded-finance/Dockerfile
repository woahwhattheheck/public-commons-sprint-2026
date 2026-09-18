FROM python:3.13-slim
LABEL qfbench2.interface_version="2.0"
WORKDIR /app
COPY agenthon_t4 /app/agenthon_t4
ENTRYPOINT ["python", "-m", "agenthon_t4.cli"]
CMD ["analyze", "--help"]
