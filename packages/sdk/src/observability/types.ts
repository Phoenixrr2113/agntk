export interface ObservabilityConfig {
  provider: 'langfuse';

  langfuse?: LangfuseConfig;
}

export interface LangfuseConfig {
  publicKey?: string;

  secretKey?: string;

  baseUrl?: string;

  debug?: boolean;
}

export interface TelemetrySettings {
  isEnabled: boolean;
  functionId?: string;
  metadata?: Record<string, unknown>;
}
