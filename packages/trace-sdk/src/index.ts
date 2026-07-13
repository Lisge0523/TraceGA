import { traceCore, TraceCore } from './core/TraceCore';
import type { CommonParams, EventPriority, TraceConfig, TrackEventParams } from './types';

export { traceCore, TraceCore };

export function register(config: TraceConfig): void {
  traceCore.register(config);
}

export function trackEvent(eventName: string, params?: TrackEventParams, priority?: EventPriority): void {
  traceCore.trackEvent(eventName, params, priority);
}

export function addCommonParams(params: CommonParams): void {
  traceCore.addCommonParams(params);
}

export function removeCommonParams(keys: string[]): void {
  traceCore.removeCommonParams(keys);
}

export function getCommonParams(): CommonParams {
  return traceCore.getCommonParams();
}

export { collectEnvInfo } from './core/env';
export * from './plugins';
export * from './types';
export * from './utils';
