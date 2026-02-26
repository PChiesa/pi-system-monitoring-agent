FROM oven/bun:1

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    curl \
    ca-certificates \
    git \
    sudo \
    gnupg \
    procps \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS (required by Claude Code CLI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm
RUN npm install -g @anthropic-ai/claude-code

# Grant sudo to the bun user (UID 1000, already exists in oven/bun:1)
RUN echo "bun ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bun \
    && chmod 0440 /etc/sudoers.d/bun

# Create bun cache directory with correct ownership
RUN mkdir -p /home/bun/.bun/install/cache && chown -R bun:bun /home/bun/.bun

WORKDIR /workspace
USER bun
