FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install simulator dependencies (cached layer)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Install UI dependencies (cached layer)
COPY ui/package.json ui/bun.lock ui/
RUN cd ui && bun install --frozen-lockfile

# Copy all source
COPY . .

# Build UI with Bun
RUN cd ui && bun run build

ENV SIM_PORT=8443

EXPOSE 8443

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fk https://localhost:${SIM_PORT}/admin/status || exit 1

ENTRYPOINT ["bun", "run", "index.ts"]
