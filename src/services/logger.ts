type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export class Logger {
  static info(message: string, data?: unknown): void {
    Logger.write('INFO', message, data);
  }

  static warn(message: string, data?: unknown): void {
    Logger.write('WARN', message, data);
  }

  static error(message: string, data?: unknown): void {
    Logger.write('ERROR', message, data);
  }

  static success(message: string, data?: unknown): void {
    Logger.write('SUCCESS', message, data);
  }

  private static write(level: LogLevel, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${suffix}`;

    if (level === 'ERROR') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
