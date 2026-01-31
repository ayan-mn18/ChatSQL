import dotenv from 'dotenv';
import { z } from 'zod';
import cors from 'cors';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

// Environment variable schema
const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  
  // Database
  DB_HOST: z.string().min(1, 'DB_HOST is required'),
  DB_PORT: z.string().transform(Number).default('5432'),
  DB_NAME: z.string().min(1, 'DB_NAME is required'),
  DB_USERNM: z.string().min(1, 'DB_USERNM is required'),
  DB_PWD: z.string().min(1, 'DB_PWD is required'),
  
  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  
  // Redis (optional for now)
  REDIS_URL: z.string().url().optional(),
  
  // AI Services (optional)
  GOOGLE_AI_API_KEY: z.string().optional(),
  // Gemini model name (optional)
  // Example: gemini-1.5-flash
  GOOGLE_AI_MODEL: z.string().default('gemini-1.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  
  // Dodo Payments
  DODO_PAYMENTS_API_KEY: z.string().optional(),
  DODO_WEBHOOK_SECRET: z.string().optional(),
  DODO_PRODUCT_ID_PRO_MONTHLY: z.string().optional(),  // Pro monthly subscription product ID
  DODO_PRODUCT_ID_PRO_YEARLY: z.string().optional(),   // Pro yearly subscription product ID
  DODO_PRODUCT_ID_LIFETIME: z.string().optional(),     // Lifetime one-time payment product ID
  DODO_PAYMENTS_MODE: z.enum(['test_mode', 'live_mode']).default('test_mode'),
  
  // App URLs
  APP_URL: z.string().default('http://localhost:5173'),
  API_URL: z.string().default('http://localhost:3000'),
  
  // CORS
  CORS_ORIGIN: z.string().default('*'),
});

// Validate and export environment variables
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missing = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      logger.error('❌ Environment validation failed:');
      missing.forEach(m => logger.error(`   - ${m}`));
      process.exit(1);
    }
    throw error;
  }
};

export const env = parseEnv();

// Export individual variables for convenience
export const {
  NODE_ENV,
  PORT,
  DB_HOST,
  DB_PORT,
  DB_NAME,
  DB_USERNM,
  DB_PWD,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
  REDIS_URL,
  GOOGLE_AI_MODEL,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  DODO_PAYMENTS_API_KEY,
  DODO_WEBHOOK_SECRET,
  DODO_PRODUCT_ID_PRO_MONTHLY,
  DODO_PRODUCT_ID_PRO_YEARLY,
  DODO_PRODUCT_ID_LIFETIME,
  DODO_PAYMENTS_MODE,
  APP_URL,
  API_URL,
  CORS_ORIGIN
} = env;

export const isDevelopment = NODE_ENV === 'development';
export const isProduction = NODE_ENV === 'production';
export const isTest = NODE_ENV === 'test';

export const corsConfig = cors({
  origin: [CORS_ORIGIN, 'http://localhost:5173'], // Allow frontend URL
  credentials: true, // Allow cookies
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
});