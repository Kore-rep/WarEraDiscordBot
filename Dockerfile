# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy SDK into build context (needed for local dependency)
# IMPORTANT: Build from parent directory: docker build -f WarEraBot/Dockerfile -t warera-discord-bot ..
# This allows access to both WarEraBot and WarEraSDK directories
COPY WarEraSDK ./sdk

# Build the SDK first (it needs to be built before it can be used)
WORKDIR /app/sdk
RUN npm ci && npm run build
WORKDIR /app

# Copy WarEraBot package files + Prisma schema first (schema is needed for `prisma generate`)
COPY WarEraBot/package*.json ./
COPY WarEraBot/prisma ./prisma

# Update package.json to use ./sdk instead of ../WarEraSDK
# npm install will install it as a local package dependency into node_modules
RUN sed -i 's|"warera-sdk": "file:../WarEraSDK"|"warera-sdk": "file:./sdk"|' package.json

# Install ALL dependencies (including dev dependencies needed for build)
# Using npm install instead of npm ci because we modified package.json
# npm install will install the SDK from ./sdk into node_modules, treating it like a normal module
RUN npm install

# Now copy the rest of WarEraBot files (excluding node_modules which we just installed)
# Copy source files explicitly to avoid copying node_modules symlinks
COPY WarEraBot/src ./src
COPY WarEraBot/tsconfig.json ./

# Generate the Prisma client and build TypeScript (the build script runs `prisma generate && tsc`)
RUN npm run build

# Remove dev dependencies and source files to reduce image size.
# The `prisma` CLI is a runtime dependency, so it survives prune for `prisma migrate deploy` on start.
RUN npm prune --production
RUN rm -rf src tsconfig.json

# SQLite database path (see prisma/schema.prisma). Persist /app/data by bind-mounting a
# host directory to it (e.g. via Portainer), just like /app/config.
# NOTE: the container runs as uid 1001 (nodejs), so the mounted host dir must be writable by it.
ENV DATABASE_URL="file:../data/bot.db"

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (if needed for health checks)
EXPOSE 3000

# Apply pending migrations, then start the bot (see the "start" script)
CMD ["npm", "start"]

