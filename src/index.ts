import { loadConfig } from './config';
import { Bot } from './bot';
import { logger } from './utils/logger';

/**
 * Main entry point for the Discord bot
 */
async function main(): Promise<void> {
  try {
    // Load configuration from environment variables
    logger.info('Loading configuration...');
    const config = loadConfig();

    // Create and start the bot
    logger.info('Initializing bot...');
    const bot = new Bot(config);

    // Handle graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      await bot.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', error);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection', reason);
      // Don't exit on unhandled rejection, but log it
    });

    // Start the bot
    await bot.start();
  } catch (error) {
    logger.error('Failed to start bot', error);
    process.exit(1);
  }
}

// Start the application
main().catch((error) => {
  logger.error('Fatal error in main', error);
  process.exit(1);
});

