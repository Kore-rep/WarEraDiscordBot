import { createAPIClient } from "@wareraprojects/api";

// Singleton instance of the API client
export const apiClient = createAPIClient({
  apiKey: process.env.WAR_ERA_API_KEY || '',
});