# The online world: builds the client and the game server, then runs the server,
# which also serves the built client. Deployed to Fly.io (fly.toml).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY . .
RUN npm run build -w client && npm run build -w server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/client/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 8080
USER node
CMD ["node", "server/dist/main.js"]
