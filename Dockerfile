# Production image: Next.js server + Prisma. Migrations run at container start.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM base AS run
ENV NODE_ENV=production \
    STORAGE_DIR=/var/data/documents \
    PORT=3000
COPY --from=build /app ./
RUN useradd --system --uid 1001 app && mkdir -p /var/data/documents && chown -R app /var/data
USER app
EXPOSE 3000
VOLUME ["/var/data"]
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
