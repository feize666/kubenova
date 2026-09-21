import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { NativeKubeconfigService } from './native-kubeconfig.service';

@Controller(['api/users/native-access','api/v1/users/native-access'])
@UseGuards(AuthGuard)
export class NativeKubeconfigController {
  constructor(private readonly kubeconfig:NativeKubeconfigService) {}

  @Get()
  list(@Req() request:{user?:{user?:{id?:string}}}) {
    return this.kubeconfig.list(request.user?.user);
  }

  @Get(':clusterId/kubeconfig')
  async download(@Req() request:{user?:{user?:{id?:string}}},@Res() response:Response,@Param('clusterId') clusterId:string) {
    const file=await this.kubeconfig.download(request.user?.user,clusterId);
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.type(file.contentType).send(file.content);
  }
}
