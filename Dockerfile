# ============================================================
# Stage 1: Build Frontend SPA
# ============================================================
FROM node:22-bookworm-slim AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ============================================================
# Stage 2: Production Runtime
# ============================================================
FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

# Install curl for healthcheck & build tools for native C++ addons (sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install production dependencies and build native bindings
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source & database schemas
COPY src/ ./src/
COPY sql/ ./sql/

# Copy compiled frontend from builder
COPY --from=client-builder /app/client/dist ./client/dist

# Ensure persistent data directory exists
RUN mkdir -p /app/data

EXPOSE 3000

# Container Healthcheck (dynamic PORT support)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "src/index.js"]
