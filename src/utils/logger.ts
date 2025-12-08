export enum LogLevel {
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

class Logger {
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

  info(message: string, ...args: any[]): void {
    console.log(this.formatMessage(LogLevel.INFO, message, ...args));
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, ...args));
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage(LogLevel.ERROR, message, ...args));
  }

  debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, ...args));
    }
  }
}

export const logger = new Logger();
