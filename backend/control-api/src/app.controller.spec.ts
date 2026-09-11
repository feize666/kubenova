import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: jest.fn().mockReturnValue('Hello World!'),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  it('returns a secret-free readiness payload for release probes', () => {
    const payload = appController.getReadiness();

    expect(payload).toMatchObject({
      status: 'ok',
      service: 'control-api',
    });
    expect(payload.checkedAt).toEqual(expect.any(String));
    expect(JSON.stringify(payload)).not.toMatch(/secret|password|apiKey|cipher/i);
  });
});
