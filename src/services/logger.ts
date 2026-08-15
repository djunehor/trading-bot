type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

interface Logger {
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, data?: any) => void;
  success: (message: string, data?: any) => void;
}

function formatLine(level: LogLevel, module: string, message: string, data?: any): string {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${module}] [${level}]`;
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `${prefix} ${message}${suffix}`;
}

export function createLogger(module: string): Logger {
  return {
    info: (msg, data) => console.log(formatLine('INFO', module, msg, data)),
    warn: (msg, data) => console.warn(formatLine('WARN', module, msg, data)),
    error: (msg, data) => console.error(formatLine('ERROR', module, msg, data)),
    success: (msg, data) => console.log(formatLine('SUCCESS', module, msg, data)),
  };
}
