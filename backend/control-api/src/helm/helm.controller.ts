import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { assertWritePermission, type PlatformRole } from '../common/governance';
import type {
  HelmInstallRequest,
  HelmChartQuery,
  HelmListQuery,
  HelmRepositoryCreateRequest,
  HelmRepositoryImportPresetsRequest,
  HelmRepositoryQuery,
  HelmRepositoryUpdateRequest,
  HelmReleaseQuery,
  HelmRollbackRequest,
  HelmUninstallRequest,
  HelmUpgradeRequest,
} from './dto/helm.dto';
import { HelmService } from './helm.service';

interface ActorRequest {
  user?: {
    user?: {
      username?: string;
      role?: PlatformRole;
    };
  };
}

@Controller('api/helm')
@UseGuards(AuthGuard)
export class HelmController {
  constructor(private readonly helmService: HelmService) {}

  @Get('repository-presets')
  listRepositoryPresets(): Promise<unknown> {
    return this.helmService.listRepositoryPresets();
  }

  @Get('repositories')
  listRepositories(@Query() query: HelmRepositoryQuery): Promise<unknown> {
    return this.helmService.listRepositories(query);
  }

  @Post('repositories/import-presets')
  importRepositoryPresets(
    @Req() req: ActorRequest,
    @Body() body: HelmRepositoryImportPresetsRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.importRepositoryPresets(body);
  }

  @Post('repositories')
  createRepository(
    @Req() req: ActorRequest,
    @Body() body: HelmRepositoryCreateRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.createRepository(body);
  }

  @Patch('repositories/:name')
  updateRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmRepositoryUpdateRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.updateRepository(name, body);
  }

  @Delete('repositories/:name')
  removeRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmRepositoryQuery,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.deleteRepository(name, query);
  }

  @Post('repositories/:name/sync')
  syncRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmRepositoryQuery,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.syncRepository(name, query);
  }

  @Get('charts')
  listCharts(@Query() query: HelmChartQuery): Promise<unknown> {
    return this.helmService.listCharts(query);
  }

  @Get('releases')
  listReleases(@Query() query: HelmListQuery): Promise<unknown> {
    return this.helmService.listReleases(query);
  }

  @Get('releases/:name')
  getRelease(
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    return this.helmService.getRelease(name, query);
  }

  @Get('releases/:name/values')
  getReleaseValues(
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    return this.helmService.getReleaseValues(name, query);
  }

  @Get('releases/:name/manifest')
  getReleaseManifest(
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    return this.helmService.getReleaseManifest(name, query);
  }

  @Get('releases/:name/history')
  getReleaseHistory(
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    return this.helmService.getReleaseHistory(name, query);
  }

  @Post('releases/install')
  installRelease(
    @Req() req: ActorRequest,
    @Body() body: HelmInstallRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.installRelease(body);
  }

  @Post('releases/:name/upgrade')
  upgradeRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmUpgradeRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.upgradeRelease(name, body);
  }

  @Post('releases/:name/rollback')
  rollbackRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmRollbackRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.rollbackRelease(name, body);
  }

  @Delete('releases/:name')
  uninstallRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
    @Body() body: HelmUninstallRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.helmService.uninstallRelease(name, {
      ...body,
      clusterId: body.clusterId ?? query.clusterId,
      namespace: body.namespace ?? query.namespace,
    });
  }
}
