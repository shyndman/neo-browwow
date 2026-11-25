import { configure, getAnsiColorFormatter, getConsoleSink, getLogger } from '@logtape/logtape';

const logger = getLogger(['browwow', 'pipeline', 'logging']);

export async function configureLogging(): Promise<void> {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: getAnsiColorFormatter({
          sourceLocation: true,
          value: 'bare',
          sanitize: { newlines: 'preserve' },
        }),
      }),
    },
    loggers: [
      {
        category: ['logtape', 'meta'],
        lowestLevel: 'warning',
        sinks: ['console'],
      },
      {
        category: ['browwow'],
        lowestLevel: 'debug',
        sinks: ['console'],
        captureSourceLocation: true,
      },
    ],
  });

  logger.debug('Configured console logging for browwow at debug level.');
}
