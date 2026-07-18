import type { ITraceCore, TracePlugin } from '../../types';
import { HttpErrorHandler } from './handlers/HttpErrorHandler';
import { JsErrorHandler } from './handlers/JsErrorHandler';
import { PromiseErrorHandler } from './handlers/PromiseErrorHandler';
import { ResourceErrorHandler } from './handlers/ResourceErrorHandler';
import type { ErrorHandler, ErrorPluginOptions } from './types';

export class ErrorPlugin implements TracePlugin {
  name = 'ErrorPlugin';

  private installed = false;
  private activeHandlers: ErrorHandler[] = [];
  private readonly handlers: ErrorHandler[] = [new JsErrorHandler(), new PromiseErrorHandler(), new ResourceErrorHandler(), new HttpErrorHandler()];

  constructor(private readonly options: ErrorPluginOptions = {}) {}

  install(core: ITraceCore): void {
    if (this.installed) {
      return;
    }

    if (!core || typeof core.trackEvent !== 'function') {
      this.reportError(new TypeError('ErrorPlugin requires a valid TraceCore'), 'error.install.core');
      return;
    }

    this.handlers.forEach(handler => {
      try {
        handler.install(core);
        this.activeHandlers.push(handler);
      } catch (error) {
        this.reportError(error, 'error.install.handler');
      }
    });
    this.installed = true;
  }

  uninstall(): void {
    if (!this.installed) {
      return;
    }

    const handlers = [...this.activeHandlers].reverse();
    this.activeHandlers = [];
    this.installed = false;

    handlers.forEach(handler => {
      try {
        handler.uninstall();
      } catch (error) {
        this.reportError(error, 'error.uninstall.handler');
      }
    });
  }

  private reportError(error: unknown, context: string): void {
    try {
      this.options.onError?.(error, context);
    } catch {
      // User callbacks must never escape the plugin boundary.
    }
  }
}
