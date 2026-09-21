import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { NativeRbacReconcileService } from './native-rbac-reconcile.service';

@Controller(['api/users/native-access','api/v1/users/native-access'])
@UseGuards(AuthGuard)
export class NativeRbacReconcileController {
  constructor(private readonly service:NativeRbacReconcileService) {}

  @Post(':clusterId/reconcile')
  reconcile(@Req() request:{user?:{user?:{id?:string;role?:string}}},@Param('clusterId') clusterId:string) {
    return this.service.reconcile(request.user?.user,clusterId);
  }
}
