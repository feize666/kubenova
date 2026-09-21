import { Body, Controller, Get, Header, Param, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { ValidatedSession } from './auth.service';
import { NativeSettingsService } from './native-settings.service';

@Controller(['api/users/native-access','api/v1/users/native-access'])
@UseGuards(AuthGuard)
export class NativeSettingsController {
  constructor(private readonly settings:NativeSettingsService) {}

  @Get(':clusterId')
  @Header('Cache-Control','no-store')
  get(@Req() request:{user?:ValidatedSession},@Param('clusterId') clusterId:string) {
    return this.settings.get(request.user?.user,clusterId);
  }

  @Put(':clusterId')
  @Header('Cache-Control','no-store')
  save(@Req() request:{user?:ValidatedSession},@Param('clusterId') clusterId:string,@Body() body:unknown) {
    return this.settings.save(request.user?.user,clusterId,body);
  }
}
