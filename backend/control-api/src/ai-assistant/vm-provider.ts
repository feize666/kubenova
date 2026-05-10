export type VmPowerOperation = 'power-on' | 'power-off' | 'restart';

export interface VmPowerActionRequest {
  provider: string;
  vmId: string;
  operation: VmPowerOperation;
  requestId: string;
  actor: string;
  reason?: string;
}

export interface VmPowerActionResult {
  accepted: boolean;
  provider: string;
  vmId: string;
  operation: VmPowerOperation;
  message: string;
  requestId: string;
}

export interface VmActionProvider {
  readonly name: string;
  executePowerAction(
    request: VmPowerActionRequest,
  ): Promise<VmPowerActionResult>;
}
