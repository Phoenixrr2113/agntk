import { createLogger } from '@agntk/logger';
import type { ObservabilityConfig, TelemetrySettings } from './types';

const log = createLogger('@agntk/core:observability');

let initialized = false;

let tracerProviderRef: { forceFlush: () => Promise<void>; shutdown: () => Promise<void> } | null =
  null;

export async function initObservability(config: ObservabilityConfig): Promise<boolean> {
  if (initialized) {
    log.warn('Observability already initialized, skipping');
    return true;
  }

  if (config.provider !== 'langfuse') {
    log.error('Unsupported observability provider', { provider: config.provider });
    return false;
  }

  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<Record<string, unknown>>;

    const langfuseModule = (await dynamicImport('langfuse-vercel')) as {
      LangfuseExporter: new (config: Record<string, unknown>) => unknown;
    };

    const publicKey = config.langfuse?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = config.langfuse?.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
    const baseUrl =
      config.langfuse?.baseUrl ??
      process.env.LANGFUSE_BASE_URL ??
      process.env.LANGFUSE_BASEURL ??
      'https://cloud.langfuse.com';

    if (!publicKey || !secretKey) {
      log.warn('Langfuse keys not provided, observability disabled');
      return false;
    }

    const exporter = new langfuseModule.LangfuseExporter({
      publicKey,
      secretKey,
      baseUrl,
      debug: config.langfuse?.debug ?? false,
    });

    const nodeTracingModule = (await dynamicImport('@opentelemetry/sdk-trace-node')) as {
      NodeTracerProvider: new (config?: Record<string, unknown>) => {
        register: () => void;
        forceFlush: () => Promise<void>;
        shutdown: () => Promise<void>;
      };
      SimpleSpanProcessor: new (exporter: unknown) => unknown;
    };

    const processor = new nodeTracingModule.SimpleSpanProcessor(exporter);

    const provider = new nodeTracingModule.NodeTracerProvider({
      spanProcessors: [processor],
    });
    provider.register();

    tracerProviderRef = provider;
    initialized = true;
    log.info('Langfuse observability initialized', { baseUrl });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
      log.info(
        'Langfuse not installed, observability features disabled. Install with: pnpm add langfuse-vercel @opentelemetry/sdk-trace-node @opentelemetry/api',
      );
    } else {
      log.warn('Failed to initialize Langfuse observability', { error: message });
    }

    return false;
  }
}

export function createTelemetrySettings(options?: {
  functionId?: string;
  metadata?: Record<string, unknown>;
}): TelemetrySettings {
  return {
    get isEnabled() {
      return initialized;
    },
    functionId: options?.functionId,
    metadata: options?.metadata,
  };
}

export function isObservabilityEnabled(): boolean {
  return initialized;
}

export async function shutdownObservability(): Promise<void> {
  if (!initialized) return;

  try {
    log.info('Observability shutdown requested — flushing traces');

    if (tracerProviderRef) {
      await tracerProviderRef.forceFlush();
      await tracerProviderRef.shutdown();
      tracerProviderRef = null;
    }

    initialized = false;
    log.info('Observability shutdown complete');
  } catch (error) {
    log.warn('Error during observability shutdown', { error: String(error) });
    initialized = false;
  }
}
