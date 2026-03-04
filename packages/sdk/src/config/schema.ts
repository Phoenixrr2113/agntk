import { z } from 'zod';

export const ModelTierSchema = z.enum(['fast', 'standard', 'reasoning', 'powerful']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ProviderSchema = z.enum(['openrouter', 'ollama', 'openai', 'cerebras', 'agntk-free']);
export type Provider = z.infer<typeof ProviderSchema>;

export const CustomProviderSchema = z.object({
  baseURL: z.string(),

  apiKeyEnv: z.string(),

  headers: z.record(z.string(), z.string()).optional(),

  tiers: z.record(z.string(), z.string()).optional(),
});

export type CustomProvider = z.infer<typeof CustomProviderSchema>;

export const ModelsConfigSchema = z
  .object({
    defaultProvider: ProviderSchema.optional(),

    tiers: z.record(z.string(), z.string()).optional(),

    providers: z.record(z.string(), z.record(z.string(), z.string())).optional(),

    customProviders: z.record(z.string(), CustomProviderSchema).optional(),
  })
  .optional();

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export const RoleConfigSchema = z.object({
  systemPrompt: z.string().optional(),

  recommendedModel: ModelTierSchema.optional(),

  defaultTools: z.array(z.string()).optional(),
});

export type RoleConfig = z.infer<typeof RoleConfigSchema>;

export const AgentConfigSchema = z.object({
  models: ModelsConfigSchema,

  roles: z.record(z.string(), RoleConfigSchema).optional(),

  toolPresets: z
    .record(
      z.string(),
      z.object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),

  templates: z
    .object({
      variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .optional(),

  memory: z
    .object({
      adapter: z.enum(['vectra']).optional(),
      path: z.string().optional(),
      embedModel: z.string().optional(),
      topK: z.number().optional(),
      similarityThreshold: z.number().optional(),
    })
    .optional(),

  tools: z
    .object({
      shell: z
        .object({
          timeout: z.number().optional(),
          maxTimeout: z.number().optional(),
          maxCommandLength: z.number().optional(),
        })
        .optional(),
      glob: z
        .object({
          timeout: z.number().optional(),
          maxFiles: z.number().optional(),
          maxDepth: z.number().optional(),
          maxOutputBytes: z.number().optional(),
        })
        .optional(),
      grep: z
        .object({
          timeout: z.number().optional(),
          maxContext: z.number().optional(),
          maxOutputBytes: z.number().optional(),
        })
        .optional(),
      plan: z
        .object({
          maxSteps: z.number().optional(),
          delegationThreshold: z.number().optional(),
        })
        .optional(),
    })
    .optional(),

  server: z
    .object({
      port: z.number().optional(),
      host: z.string().optional(),
    })
    .optional(),

  client: z
    .object({
      timeout: z.number().optional(),
      retries: z.number().optional(),
      websocket: z
        .object({
          reconnectDelay: z.number().optional(),
          maxReconnects: z.number().optional(),
        })
        .optional(),
    })
    .optional(),

  workspaceRoot: z.string().optional(),

  maxSteps: z.number().optional(),

  debug: z
    .object({
      enabled: z.boolean().optional(),
      level: z.enum(['error', 'warn', 'info', 'debug', 'trace']).optional(),
      file: z.string().optional(),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const PartialAgentConfigSchema = AgentConfigSchema.partial();
export type PartialAgentConfig = z.infer<typeof PartialAgentConfigSchema>;
