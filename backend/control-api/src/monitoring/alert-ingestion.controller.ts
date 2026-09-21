import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { AlertIngestionService } from './alert-ingestion.service';

@Controller('api/monitoring/clusters/:clusterId/receiver')
export class AlertIngestionController {
  constructor(private readonly ingestion: AlertIngestionService) {}

  @Post('alerts')
  @HttpCode(200)
  receive(@Param('clusterId') clusterId: string, @Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    return this.ingestion.ingest(clusterId, authorization, body);
  }
}
