# Use Node.js LTS version
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including local SDK)
# Note: The SDK should be available at build time
# For Azure, you may need to adjust this based on your deployment strategy
RUN npm ci --only=production

# Copy source files
COPY . .

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

