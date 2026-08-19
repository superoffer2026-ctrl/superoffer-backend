import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'superoffer-backend', version: '2.0.0' };
  }

  @Get()
  root() {
    return { status: 'ok', service: 'superoffer-backend', api_base: '/api/v1' };
  }
}
