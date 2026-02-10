import { Logtail } from '@logtail/node';

export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

// ============================================
// BetterStack-powered Logger
// All logs go to console + BetterStack Logtail
// Zero changes needed in consumer files
// ============================================

class Logger {
  private logtail: Logtail | null = null;

  constructor() {
    const token = process.env.BETTERSTACK_SOURCE_TOKEN;
    if (token) {
      this.logtail = new Logtail(token, {
        batchSize: 10,
        batchInterval: 1000,
        retryCount: 3,
        sendLogsToBetterStack: true,
      });
    }
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = this.getTimestamp();
    const argsString = args.length > 0 ? args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ') : '';
    
    return `[${timestamp}] [${level}] ${message} ${argsString}`;
  }

  /** Extract structured context from variadic args */
  private extractContext(args: any[]): Record<string, any> {
    if (args.length === 0) return {};

    // If first arg is a plain object (not Error), treat it as context
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !(args[0] instanceof Error)) {
      return args[0];
    }

    // If there's an Error, extract its properties
    const context: Record<string, any> = {};
    for (const arg of args) {
      if (arg instanceof Error) {
        context.errorName = arg.name;
        context.errorMessage = arg.message;
        context.stack = arg.stack;
        // Capture extra properties like PG error codes
        const extras = arg as any;
        if (extras.code) context.errorCode = extras.code;
        if (extras.statusCode) context.statusCode = extras.statusCode;
      } else if (typeof arg === 'object' && arg !== null) {
        Object.assign(context, arg);
      } else if (typeof arg === 'string' || typeof arg === 'number') {
        context.detail = arg;
      }
    }
    return context;
  }

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage(LogLevel.INFO, message, ...args));
    if (this.logtail) {
      this.logtail.info(message, this.extractContext(args));
    }
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, ...args));
    if (this.logtail) {
      this.logtail.warn(message, this.extractContext(args));
    }
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage(LogLevel.ERROR, message, ...args));
    if (this.logtail) {
      this.logtail.error(message, this.extractContext(args));
    }
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, ...args));
    }
    if (this.logtail) {
      this.logtail.debug(message, this.extractContext(args));
    }
  }

  /**
   * Flush all pending logs to BetterStack.
   * Call this before process exit to ensure nothing is lost.
   */
  async flush(): Promise<void> {
    if (this.logtail) {
      await this.logtail.flush();
    }
  }
}

export const logger = new Logger();
