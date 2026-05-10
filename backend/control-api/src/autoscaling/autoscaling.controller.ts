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
  AutoscalingType,
  DeleteAutoscalingPolicyRequest,
  CreateAutoscalingPolicyRequest,
  UpdateAutoscalingPolicyRequest,
} from './dto/autoscaling.dto';
import { AutoscalingService } from './autoscaling.service';

interface RequestActor {
  user?: {
    username?: string;
    role?: PlatformRole;
  };
}

@Controller('api/autoscaling')
@UseGuards(AuthGuard)
export class AutoscalingController {
  constructor(private readonly autoscalingService: AutoscalingService) {}

  @Get('policies')
  list(
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('kind') kind?: string,
    @Query('type') type?: AutoscalingType,
    @Query('state') state?: 'enabled' | 'disabled',
    @Query('keyword') keyword?: string,
  ) {
    return this.autoscalingService.list({
      clusterId: clusterId?.trim() || undefined,
      namespace: namespace?.trim() || undefined,
      kind: kind?.trim() || undefined,
      type,
      state,
      keyword: keyword?.trim() || undefined,
    });
  }

  @Post('policies')
  create(
    @Req() req: { user?: RequestActor },
    @Body() body: CreateAutoscalingPolicyRequest,
  ) {
    return this.autoscalingService.create(req.user?.user, body);
  }

  @Patch(':type/:kind/:name')
  update(
    @Req() req: { user?: RequestActor },
    @Param('type') type: AutoscalingType,
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Body() body: UpdateAutoscalingPolicyRequest,
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
  ) {
    return this.autoscalingService.update(
      req.user?.user,
      type,
      kind,
      name,
      {
        clusterId: clusterId?.trim() || undefined,
        namespace: namespace?.trim() || undefined,
      },
      body,
    );
  }

  @Post(':type/:kind/:name/enable')
  enable(
    @Req() req: { user?: RequestActor },
    @Param('type') type: AutoscalingType,
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
  ) {
    return this.autoscalingService.setPolicyState(
      req.user?.user,
      type,
      kind,
      name,
      {
        clusterId: clusterId?.trim() || undefined,
        namespace: namespace?.trim() || undefined,
      },
      true,
    );
  }

  @Post(':type/:kind/:name/disable')
  disable(
    @Req() req: { user?: RequestActor },
    @Param('type') type: AutoscalingType,
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
  ) {
    return this.autoscalingService.setPolicyState(
      req.user?.user,
      type,
      kind,
      name,
      {
        clusterId: clusterId?.trim() || undefined,
        namespace: namespace?.trim() || undefined,
      },
      false,
    );
  }

  @Delete(':type/:kind/:name')
  delete(
    @Req() req: { user?: RequestActor },
    @Param('type') type: AutoscalingType,
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
  ) {
    const query: DeleteAutoscalingPolicyRequest = {
      clusterId: clusterId?.trim() || undefined,
      namespace: namespace?.trim() || undefined,
    };
    return this.autoscalingService.delete(
      req.user?.user,
      type,
      kind,
      name,
      query,
    );
  }

  @Get('events')
  events(
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('kind') kind?: string,
    @Query('name') name?: string,
    @Query('hours') hours?: string,
  ) {
    return this.autoscalingService.listEvents({
      clusterId: clusterId?.trim() || undefined,
      namespace: namespace?.trim() || undefined,
      kind: kind?.trim() || undefined,
      name: name?.trim() || undefined,
      hours: hours?.trim() || undefined,
    });
  }
}
