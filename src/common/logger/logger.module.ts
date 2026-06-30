import { Module, Global } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as winston from 'winston';

const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'pass'];

const redactFormat = winston.format((info) => {
  const redact = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        obj[key] = '[REDACTED]';
      } else if (obj[key] && typeof obj[key] === 'object') {
        redact(obj[key] as Record<string, unknown>);
      }
    }
  };
  redact(info as unknown as Record<string, unknown>);
  return info;
})();

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        const level = config.get<string>('LOG_LEVEL', 'log');
        const winstonLevel = level === 'log' ? 'info' : level;

        const formats = isProd
          ? [redactFormat, winston.format.json()]
          : [
              redactFormat,
              winston.format.colorize(),
              winston.format.simple(),
            ];

        return {
          transports: [
            new winston.transports.Console({
              level: winstonLevel,
              format: winston.format.combine(
                winston.format.timestamp(),
                ...formats,
              ),
            }),
          ],
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
