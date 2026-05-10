import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { PlatformRole } from '../common/governance';
import type {
  AuditLogsResponse,
  CreateAuditPolicyRequest,
  SecurityCreateRbacRequest,
  SecurityAuditPoliciesResponse,
  SecurityEventsResponse,
  SecurityStatsResponse,
  SecuritySummaryResponse,
  SecurityUpdateRbacRequest,
  UpdateAuditPolicyRequest,
} from './security.service';
import { SecurityService } from './security.service';

interface RequestActor {
  user?: {
    username?: string;
    role?: PlatformRole;
  };
}

@Controller('api/security')
@UseGuards(AuthGuard)
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('summary')
  getSummary(): SecuritySummaryResponse {
    return this.securityService.getSummary();
  }

  @Get('stats')
  getStats(): SecurityStatsResponse {
    return this.securityService.getStats();
  }

  @Get('events')
  getEvents(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): SecurityEventsResponse {
    return this.securityService.getEvents({
      severity,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // RBAC compatibility routes — prefix: /security/rbac
  // -------------------------------------------------------------------------
  @Get('rbac')
  listRbac(
    @Query('keyword') keyword?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.securityService.listRbac({
      keyword,
      kind,
      page,
      pageSize,
    });
  }

  @Post('rbac')
  createRbac(
    @Req() req: { user?: RequestActor },
    @Body() body: SecurityCreateRbacRequest,
  ) {
    return this.securityService.createRbac(req.user?.user, body);
  }

  @Patch('rbac/:id')
  updateRbac(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: SecurityUpdateRbacRequest,
  ) {
    return this.securityService.updateRbac(req.user?.user, id, body);
  }

  @Delete('rbac/:id')
  deleteRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.securityService.deleteRbac(req.user?.user, id);
  }

  @Post('rbac/:id/disable')
  disableRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.securityService.setRbacState(req.user?.user, id, 'disabled');
  }

  @Post('rbac/:id/enable')
  enableRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.securityService.setRbacState(req.user?.user, id, 'active');
  }

  @Patch('events/:id/resolve')
  resolveEvent(@Req() req: RequestActor, @Param('id') id: string) {
    return this.securityService.resolveEvent(req.user, id);
  }

  @Get('audit-logs')
  getAuditLogs(
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('actor') actor?: string,
    @Query('result') result?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): AuditLogsResponse {
    return this.securityService.getAuditLogs({
      action,
      resourceType,
      actor,
      result,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Get('audit-policies')
  listAuditPolicies(): SecurityAuditPoliciesResponse {
    return this.securityService.listAuditPolicies();
  }

  @Post('audit-policies')
  createAuditPolicy(
    @Req() req: { user?: RequestActor },
    @Body() body: CreateAuditPolicyRequest,
  ) {
    return this.securityService.createAuditPolicy(req.user?.user, body);
  }

  @Patch('audit-policies/:id')
  updateAuditPolicy(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: UpdateAuditPolicyRequest,
  ) {
    return this.securityService.updateAuditPolicy(req.user?.user, id, body);
  }

  @Delete('audit-policies/:id')
  deleteAuditPolicy(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.securityService.deleteAuditPolicy(req.user?.user, id);
  }

  @Post('audit-policies/:id/disable')
  disableAuditPolicy(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.securityService.setAuditPolicyState(
      req.user?.user,
      id,
      'disabled',
    );
  }

  @Post('audit-policies/:id/enable')
  enableAuditPolicy(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.securityService.setAuditPolicyState(
      req.user?.user,
      id,
      'active',
    );
  }
}
