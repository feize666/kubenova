import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
  CreateRbacRequest,
  CreateUserRequest,
  RbacListQuery,
  UpdateRbacRequest,
  UpdateUserRequest,
  UsersListQuery,
} from './users.service';
import { UsersService } from './users.service';

interface RequestActor {
  user?: {
    username?: string;
    role?: PlatformRole;
  };
}

@Controller(['api/users', 'api/v1/users'])
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // -------------------------------------------------------------------------
  // Users CRUD
  // -------------------------------------------------------------------------

  /** GET /users — 列表（数据库分页） */
  @Get()
  listUsers(@Query() query: UsersListQuery) {
    return this.usersService.listUsers(query);
  }

  // -------------------------------------------------------------------------
  // RBAC routes — prefix: /users/rbac
  // -------------------------------------------------------------------------

  /** GET /users/rbac — RBAC 列表 */
  @Get('rbac')
  listRbac(@Query() query: RbacListQuery) {
    return this.usersService.listRbac(query);
  }

  /** POST /users/rbac — 创建 RBAC 绑定 */
  @Post('rbac')
  createRbac(
    @Req() req: { user?: RequestActor },
    @Body() body: CreateRbacRequest,
  ) {
    return this.usersService.createRbac(req.user?.user, body);
  }

  /** PATCH /users/rbac/:id — 更新 RBAC 绑定 */
  @Patch('rbac/:id')
  updateRbac(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: UpdateRbacRequest,
  ) {
    return this.usersService.updateRbac(req.user?.user, id, body);
  }

  /** DELETE /users/rbac/:id — 删除 RBAC 绑定 */
  @Delete('rbac/:id')
  deleteRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.deleteRbac(req.user?.user, id);
  }

  /** POST /users/rbac/:id/enable — 启用 RBAC 绑定 */
  @Post('rbac/:id/enable')
  enableRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.setRbacState(req.user?.user, id, 'active');
  }

  /** POST /users/rbac/:id/disable — 禁用 RBAC 绑定 */
  @Post('rbac/:id/disable')
  disableRbac(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.setRbacState(req.user?.user, id, 'disabled');
  }

  /** GET /users/:id — 单条查询 */
  @Get(':id')
  async findById(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  /** POST /users — 创建用户 */
  @Post()
  createUser(
    @Req() req: { user?: RequestActor },
    @Body() body: CreateUserRequest,
  ) {
    return this.usersService.createUser(req.user?.user, body);
  }

  /** PATCH /users/:id — 更新用户 */
  @Patch(':id')
  updateUser(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: UpdateUserRequest,
  ) {
    return this.usersService.updateUser(req.user?.user, id, body);
  }

  /** DELETE /users/:id — 软删除 */
  @Delete(':id')
  deleteUser(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.deleteUser(req.user?.user, id);
  }

  /** POST /users/:id/enable — 启用 */
  @Post(':id/enable')
  enableUser(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.setState(req.user?.user, id, true);
  }

  /** POST /users/:id/disable — 禁用 */
  @Post(':id/disable')
  disableUser(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.usersService.setState(req.user?.user, id, false);
  }
}
