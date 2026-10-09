FROM node:22-alpine
WORKDIR /app
COPY package.json *.mjs index.html app.js styles.css ./
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
