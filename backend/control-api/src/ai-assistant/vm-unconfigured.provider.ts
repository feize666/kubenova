import type {
  VmActionProvider,
  VmPowerActionRequest,
  VmPowerActionResult,
} from './vm-provider';

export class UnconfiguredVmActionProvider implements VmActionProvider {
  readonly name = 'unconfigured';

  async executePowerAction(
    request: VmPowerActionRequest,
  ): Promise<VmPowerActionResult> {
    return {
      accepted: false,
      provider: request.provider,
      vmId: request.vmId,
      operation: request.operation,
      requestId: request.requestId,
      message:
        'VM provider 尚未配置。请先在平台接入具体虚拟化/云厂商 provider 后再执行 VM 电源操作。',
    };
  }
}
