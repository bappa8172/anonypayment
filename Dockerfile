# ============================================================
# Stage 1: Build Frontend SPA
# ============================================================
FROM node:20-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# ============================================================
# Stage 2: Production Runtime
# ============================================================
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
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

# Container Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
