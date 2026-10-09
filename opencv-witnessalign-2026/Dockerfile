FROM public.ecr.aws/lambda/python:3.12
COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt
COPY witnessalign ${LAMBDA_TASK_ROOT}/witnessalign
CMD ["witnessalign.aws_lambda.handler"]
