import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { AppConfig } from './platform/config/env.schema';
import { AppModule } from './app.module';
import { loadAiEnvFile } from './ai-assistant/ai-config.util';

// 在应用初始化前加载 AI 配置文件（.env.ai.local）
loadAiEnvFile();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService<AppConfig>>(ConfigService);
  const port = configService.get<number>('port', 4000);
  const swaggerEnabled = configService.get<boolean>('swaggerEnabled', true);

  const rawOrigins =
    process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow non-browser or same-origin requests.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      // In non-production, allow localhost/127.0.0.1 origins on any port.
      const isDev = process.env.NODE_ENV !== 'production';
      if (
        isDev &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`), false);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const isProduction = process.env.NODE_ENV === 'production';
  if (swaggerEnabled && !isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('KubeNova Control API')
      .setDescription('Backend control plane for KubeNova')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, swaggerDocument, {
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  await app.listen(port);
}

void bootstrap();
