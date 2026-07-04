import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORTAL_BASE_URL: z.string().url(),
  PORTAL_API_BASE_URL: z.string().url().optional(),
  PORTAL_LOGIN_URL: z.string().url(),
  PORTAL_USERNAME: z.string().min(1),
  PORTAL_PASSWORD: z.string().min(1),
  PORTAL_ROLE: z.enum(["user", "admin"]).default("user"),
  PORTAL_WORKSPACE_OWNER: z.string().optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().min(1).default("qwen3:latest"),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default("nomic-embed-text:latest"),
  AGENT_ENABLE_LLM: z.coerce.boolean().default(false),
  CHROMA_HOST: z.string().min(1).default("127.0.0.1"),
  CHROMA_PORT: z.coerce.number().int().positive().default(8000),
  CHROMA_COLLECTION: z.string().min(1).default("monflow_portal_knowledge"),
  AGENT_OUTPUT_DIR: z.string().min(1).default("./artifacts"),
  AGENT_HEADLESS: z.coerce.boolean().default(true),
  AGENT_MAX_PAGES: z.coerce.number().int().positive().default(250),
  AGENT_MAX_DEPTH: z.coerce.number().int().positive().default(6),
  AGENT_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AGENT_SLOW_MO: z.coerce.number().int().nonnegative().default(0),
  AGENT_ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5000"),
  AGENT_SAFE_MODE: z.coerce.boolean().default(true),
  AGENT_USE_ROUTE_SEED: z.coerce.boolean().default(true),
  AGENT_PUSH_TO_BACKEND: z.coerce.boolean().default(false),
  AGENT_INGEST_ENDPOINT: z.string().url().optional(),
  AGENT_INGEST_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);

export const agentConfig = {
  portal: {
    baseUrl: env.PORTAL_BASE_URL,
    apiBaseUrl: env.PORTAL_API_BASE_URL,
    loginUrl: env.PORTAL_LOGIN_URL,
    credentials: {
      username: env.PORTAL_USERNAME,
      password: env.PORTAL_PASSWORD,
      role: env.PORTAL_ROLE
    },
    workspaceOwner: env.PORTAL_WORKSPACE_OWNER
  },
  ollama: {
    baseUrl: env.OLLAMA_BASE_URL,
    chatModel: env.OLLAMA_CHAT_MODEL,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    enabled: env.AGENT_ENABLE_LLM
  },
  chroma: {
    url: `http://${env.CHROMA_HOST}:${env.CHROMA_PORT}`,
    collectionName: env.CHROMA_COLLECTION
  },
  crawl: {
    outputDir: env.AGENT_OUTPUT_DIR,
    headless: env.AGENT_HEADLESS,
    maxPages: env.AGENT_MAX_PAGES,
    maxDepth: env.AGENT_MAX_DEPTH,
    concurrency: env.AGENT_CONCURRENCY,
    slowMo: env.AGENT_SLOW_MO,
    allowedOrigins: env.AGENT_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
    safeMode: env.AGENT_SAFE_MODE,
    useRouteSeed: env.AGENT_USE_ROUTE_SEED,
    pushToBackend: env.AGENT_PUSH_TO_BACKEND,
    ingestEndpoint: env.AGENT_INGEST_ENDPOINT,
    ingestToken: env.AGENT_INGEST_TOKEN
  }
};
