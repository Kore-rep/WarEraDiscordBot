# Use Node.js LTS version
FROM node:18-alpine
# openssl: required by Prisma. git: required by npm to fetch the warera-sdk git dependency.
RUN apk add --no-cache openssl git
# Set working directory
WORKDIR /app

# warera-sdk is a public git dependency (see package.json), so the SDK no longer
# needs to be copied into the build context. Build from this repository directly:
# `docker build -t warera-discord-bot .` (the COPY paths below are relative to the repo root).

# Copy package files + Prisma schema first (schema is needed for `prisma generate`)
COPY package*.json ./
COPY prisma ./prisma

# Install ALL dependencies (including dev deps needed for build). npm ci clones the
# warera-sdk git dependency over HTTPS and runs its prepare script to build the SDK's dist/.
RUN npm ci

# Now copy the rest of WarEraBot files (excluding node_modules which we just installed)
# Copy source files explicitly to avoid copying node_modules symlinks
COPY src ./src
COPY tsconfig.json ./

# Generate the Prisma client and build TypeScript (the build script runs `prisma generate && tsc`)
RUN npm run build

# Remove dev dependencies and source files to reduce image size.
# The `prisma` CLI is a runtime dependency, so it survives prune for `prisma migrate deploy` on start.
RUN npm prune --production
RUN rm -rf src tsconfig.json

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

