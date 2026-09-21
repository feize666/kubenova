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
import { assertAdministrationPermission, type PlatformRole } from '../common/governance';
import type {
  HelmInstallRequest,
  HelmChartQuery,
  HelmListQuery,
  HelmRepositoryCreateRequest,
  HelmRepositoryImportHostRequest,
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
  listRepositoryPresets(@Req() req: ActorRequest): unknown {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.listRepositoryPresets();
  }

  @Get('repositories')
  listRepositories(@Req() req: ActorRequest, @Query() query: HelmRepositoryQuery): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.listRepositories(query);
  }

  @Post('repositories/import-presets')
  importRepositoryPresets(
    @Req() req: ActorRequest,
    @Body() body: HelmRepositoryImportPresetsRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.importRepositoryPresets(body);
  }

  @Post('repositories/import-host')
  importHostRepositories(
    @Req() req: ActorRequest,
    @Body() body: HelmRepositoryImportHostRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.importHostRepositories(body);
  }

  @Post('repositories')
  createRepository(
    @Req() req: ActorRequest,
    @Body() body: HelmRepositoryCreateRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.createRepository(body);
  }

  @Patch('repositories/:name')
  updateRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmRepositoryUpdateRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.updateRepository(name, body);
  }

  @Delete('repositories/:name')
  removeRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmRepositoryQuery,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.deleteRepository(name, query);
  }

  @Post('repositories/:name/sync')
  syncRepository(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmRepositoryQuery,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.syncRepository(name, query);
  }

  @Get('charts')
  listCharts(@Req() req: ActorRequest, @Query() query: HelmChartQuery): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.listCharts(query);
  }

  @Get('releases')
  listReleases(@Req() req: ActorRequest, @Query() query: HelmListQuery): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.listReleases(query);
  }

  @Get('releases/:name')
  getRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.getRelease(name, query);
  }

  @Get('releases/:name/values')
  getReleaseValues(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.getReleaseValues(name, query);
  }

  @Get('releases/:name/manifest')
  getReleaseManifest(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.getReleaseManifest(name, query);
  }

  @Get('releases/:name/history')
  getReleaseHistory(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Query() query: HelmReleaseQuery,
  ): Promise<unknown> {
    assertAdministrationPermission(req.user?.user);
    return this.helmService.getReleaseHistory(name, query);
  }

  @Post('releases/install')
  installRelease(
    @Req() req: ActorRequest,
    @Body() body: HelmInstallRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.installRelease(body);
  }

  @Post('releases/:name/upgrade')
  upgradeRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmUpgradeRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
    return this.helmService.upgradeRelease(name, body);
  }

  @Post('releases/:name/rollback')
  rollbackRelease(
    @Req() req: ActorRequest,
    @Param('name') name: string,
    @Body() body: HelmRollbackRequest,
  ): Promise<unknown> {
    const actor = req.user?.user;
    assertAdministrationPermission(actor);
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
    assertAdministrationPermission(actor);
    return this.helmService.uninstallRelease(name, {
      ...body,
      clusterId: body.clusterId ?? query.clusterId,
      namespace: body.namespace ?? query.namespace,
    });
  }
}
