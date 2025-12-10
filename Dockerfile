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

# Copy WarEraBot package files first (before copying everything)
COPY WarEraBot/package*.json ./

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
COPY WarEraBot/servers.json.example ./servers.json.example
COPY WarEraBot/servers.json ./servers.json

# Build TypeScript
RUN npm run build

# Remove dev dependencies and source files to reduce image size
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

# Start the bot
CMD ["node", "dist/index.js"]

