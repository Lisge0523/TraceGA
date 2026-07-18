import { traceCore, TraceCore } from './core';
import type { CommonParams, EventPriority, EventType, TraceConfig, TrackEventParams } from './types';

export { traceCore, TraceCore };

export function register(config: TraceConfig): void {
  traceCore.register(config);
}

export function trackEvent(eventName: string, params?: TrackEventParams, priority?: EventPriority, eventType?: EventType): void {
  traceCore.trackEvent(eventName, params, priority, eventType);
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

export function destroy(): void {
  traceCore.destroy();
}

export * from './core';
export * from './plugins';
export * from './types';
export * from './utils';
