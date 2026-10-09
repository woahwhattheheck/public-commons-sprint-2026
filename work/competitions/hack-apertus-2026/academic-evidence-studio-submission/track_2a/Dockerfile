FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY src/ ./src/
USER node
EXPOSE 8787 8788
CMD ["node", "src/run.mjs"]
