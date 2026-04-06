import { createLogger } from '@agntk/logger';
import type { AgentEvent } from './events';

const log = createLogger('@agntk/core:harness-gateway');

export type GatewayAction = 'forward' | 'drop' | 'log' | 'batch';

export interface GatewayRule {
  name: string;
  match: (event: AgentEvent) => boolean;
  action: GatewayAction;
}

export interface GatewayResult {
  event: AgentEvent;
  action: GatewayAction;
  matchedRule: string | null;
}

export interface Gateway {
  addRule(rule: GatewayRule): void;
  evaluate(event: AgentEvent): GatewayResult;
}

export function createGateway(defaultAction: GatewayAction = 'forward'): Gateway {
  const rules: GatewayRule[] = [];

  return {
    addRule(rule: GatewayRule): void {
      rules.push(rule);
      log.debug('Gateway rule added', { name: rule.name, action: rule.action });
    },

    evaluate(event: AgentEvent): GatewayResult {
      for (const rule of rules) {
        if (rule.match(event)) {
          log.debug('Gateway rule matched', {
            rule: rule.name,
            action: rule.action,
            eventId: event.id,
          });
          return { event, action: rule.action, matchedRule: rule.name };
        }
      }

      return { event, action: defaultAction, matchedRule: null };
    },
  };
}
