FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM base AS final
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY tsconfig.json ./

# CMD is overridden per-service in railway.toml
CMD ["bun", "run", "src/index.ts"]
