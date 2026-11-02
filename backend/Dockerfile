FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PUERTO:-3001}/api/salud" || exit 1

# Las variables (DB_URL, DB_USERNAME, ...) llegan desde docker-compose, no desde un .env copiado
CMD ["node", "src/index.js"]
