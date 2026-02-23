FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

ENV SIM_PORT=8443

EXPOSE 8443

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fk https://localhost:${SIM_PORT}/admin/status || exit 1

ENTRYPOINT ["bun", "run", "index.ts"]
