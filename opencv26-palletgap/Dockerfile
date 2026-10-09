FROM public.ecr.aws/lambda/python:3.12
COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt
COPY palletgap/ ${LAMBDA_TASK_ROOT}/palletgap/
CMD ["palletgap.aws_lambda.handler"]
