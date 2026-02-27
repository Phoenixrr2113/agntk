/**
 * @fileoverview Configuration schema definitions.
 */

import { z } from 'zod';

// ============================================================================
// Model Configuration
// ============================================================================

export const ModelTierSchema = z.enum(['fast', 'standard', 'reasoning', 'powerful']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ProviderSchema = z.enum(['openrouter', 'ollama', 'openai', 'cerebras', 'agntk-free']);
export type Provider = z.infer<typeof ProviderSchema>;

export const CustomProviderSchema = z.object({
  /** Base URL for the provider's OpenAI-compatible API */
  baseURL: z.string(),
  /** Environment variable name containing the API key */
  apiKeyEnv: z.string(),
  /** Optional custom headers to include in requests */
  headers: z.record(z.string(), z.string()).optional(),
  /** Optional tier mappings for this provider */
  tiers: z.record(z.string(), z.string()).optional(),
});

export type CustomProvider = z.infer<typeof CustomProviderSchema>;

export const ModelsConfigSchema = z.object({
  /** Default provider when none specified */
  defaultProvider: ProviderSchema.optional(),

  /** Override model for each tier (uses default provider) */
  tiers: z.record(z.string(), z.string()).optional(),

  /** Per-provider tier mappings */
  providers: z.record(z.string(), z.record(z.string(), z.string())).optional(),

  /** Custom providers with baseURL and apiKeyEnv */
  customProviders: z.record(z.string(), CustomProviderSchema).optional(),
}).optional();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// ============================================================================
// Role Configuration
// ============================================================================

export const RoleConfigSchema = z.object({
  /** System prompt for this role (optional if overriding built-in) */
  systemPrompt: z.string().optional(),

  /** Recommended model tier */
  recommendedModel: ModelTierSchema.optional(),

  /** Default tools to include */
  defaultTools: z.array(z.string()).optional(),
});

export type RoleConfig = z.infer<typeof RoleConfigSchema>;

// ============================================================================
// Full Agent Configuration
// ============================================================================

export const AgentConfigSchema = z.object({
  /** Model configuration */
  models: ModelsConfigSchema,

  /** Custom role definitions */
  roles: z.record(z.string(), RoleConfigSchema).optional(),

  /** Custom tool presets */
  toolPresets: z.record(z.string(), z.object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    description: z.string().optional(),
  })).optional(),

  /** Template variables for prompt substitution */
  templates: z.object({
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  }).optional(),

  /** Memory store configuration */
  memory: z.object({
    adapter: z.enum(['vectra']).optional(),
    path: z.string().optional(),
    embedModel: z.string().optional(),
    topK: z.number().optional(),
    similarityThreshold: z.number().optional(),
  }).optional(),

  /** Tool configuration */
  tools: z.object({
    shell: z.object({
      timeout: z.number().optional(),
      maxTimeout: z.number().optional(),
      maxCommandLength: z.number().optional(),
    }).optional(),
    glob: z.object({
      timeout: z.number().optional(),
      maxFiles: z.number().optional(),
      maxDepth: z.number().optional(),
      maxOutputBytes: z.number().optional(),
    }).optional(),
    grep: z.object({
      timeout: z.number().optional(),
      maxContext: z.number().optional(),
      maxOutputBytes: z.number().optional(),
    }).optional(),
    plan: z.object({
      maxSteps: z.number().optional(),
      delegationThreshold: z.number().optional(),
    }).optional(),
  }).optional(),

  /** Server configuration */
  server: z.object({
    port: z.number().optional(),
    host: z.string().optional(),
  }).optional(),

  /** Client configuration */
  client: z.object({
    timeout: z.number().optional(),
    retries: z.number().optional(),
    websocket: z.object({
      reconnectDelay: z.number().optional(),
      maxReconnects: z.number().optional(),
    }).optional(),
  }).optional(),

  /** Default workspace root */
  workspaceRoot: z.string().optional(),

  /** Default max steps */
  maxSteps: z.number().optional(),

  /** Debug settings */
  debug: z.object({
    enabled: z.boolean().optional(),
    level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
    file: z.string().optional(),
  }).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================================
// Partial Config (for merging)
// ============================================================================

export const PartialAgentConfigSchema = AgentConfigSchema.partial();
export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;
