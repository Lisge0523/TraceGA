import type { ITraceCore } from '../../types';

export interface ErrorHandler {
  install(core: ITraceCore): void;
  uninstall(): void;
}

export interface ErrorPayloadBase {
  type: string;
  message: string;
  errorName?: string;
  stack?: string;
}
