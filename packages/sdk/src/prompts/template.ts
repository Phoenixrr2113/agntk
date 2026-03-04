/**
 * @fileoverview Prompt template utilities for the SDK.
 * Provides functions to replace placeholdings in prompt strings with context
 * variables from both internal and configuration sources.
 */
import { createLogger } from '@agntk/logger';
import { getConfig } from '../config';

const log = createLogger('@agntk/core:templates');

interface TemplateContext {
  [key: string]: string | number | boolean | undefined;
}

export function applyTemplate(template: string, context: TemplateContext = {}): string {
  const config = getConfig();
  const configVars = (config as Record<string, unknown>).templates as
    | { variables?: TemplateContext }
    | undefined;
  const mergedContext = { ...configVars?.variables, ...context };

  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = mergedContext[varName];
    if (value === undefined) {
      log.debug('Template variable not found', { variable: varName });
      return match;
    }
    return String(value);
  });
}
