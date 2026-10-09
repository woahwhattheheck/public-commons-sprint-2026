# For deployment ONLY. The source artifact does not assert a successful cloud build.
FROM public.ecr.aws/lambda/python:3.12
COPY infra/requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt
COPY drainguard/ ${LAMBDA_TASK_ROOT}/drainguard/
CMD ["drainguard.aws_handler.handler"]
