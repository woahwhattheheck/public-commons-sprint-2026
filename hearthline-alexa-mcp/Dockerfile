FROM node:22-alpine
WORKDIR /app
COPY package.json LICENSE README.md ./
COPY src ./src
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=8787 HEARTHLINE_STORE=/app/data/hearthline-store.json
EXPOSE 8787
CMD ["node", "src/server.mjs"]
