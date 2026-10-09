# Operator must use a resolvable OpenCV 5 Python wheel or an equivalent
# reproducible source build before deploying. This intentionally fails closed
# rather than silently substituting OpenCV 4 and claiming contest eligibility.
FROM public.ecr.aws/lambda/python:3.12
RUN python -m pip install --no-cache-dir 'numpy>=2,<3' 'opencv-python-headless>=5,<6'
COPY gaugetrace.py aws_lambda.py ${LAMBDA_TASK_ROOT}/
CMD ["aws_lambda.handler"]
