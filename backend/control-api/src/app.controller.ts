import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
} from '@nestjs/common';
import { AppService } from './app.service';
import {
  CAPABILITY_BASELINE_MATRIX,
  CAPABILITIES,
  CONTRACT_VERSION,
  summarizeCapabilityBaselineMatrix,
  validateCapabilityBaselineMatrix,
} from './common/capabilities.catalog';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get(['api/capabilities', 'api/v1/capabilities'])
  @Header('Contract-Version', CONTRACT_VERSION)
  getCapabilities(
    @Headers('accept-contract-version') acceptContractVersion?: string,
  ) {
    this.assertSupportedContractVersion(acceptContractVersion);
    return {
      data: CAPABILITIES,
      meta: {
        contractVersion: CONTRACT_VERSION,
        total: CAPABILITIES.length,
      },
    };
  }

  @Get(['api/capability-baseline', 'api/v1/capability-baseline'])
  @Header('Contract-Version', CONTRACT_VERSION)
  getCapabilityBaseline(
    @Headers('accept-contract-version') acceptContractVersion?: string,
  ) {
    this.assertSupportedContractVersion(acceptContractVersion);

    const integrityIssues = validateCapabilityBaselineMatrix(
      CAPABILITY_BASELINE_MATRIX,
    );
    const summary = summarizeCapabilityBaselineMatrix(
      CAPABILITY_BASELINE_MATRIX,
      integrityIssues,
    );

    return {
      matrix: CAPABILITY_BASELINE_MATRIX,
      summary,
      updatedAt: summary.lastUpdatedAt,
      integrityIssues,
    };
  }

  private assertSupportedContractVersion(acceptContractVersion?: string): void {
    if (!acceptContractVersion) {
      return;
    }

    const requestedVersion = acceptContractVersion.split(',')[0]?.trim();
    if (requestedVersion === CONTRACT_VERSION) {
      return;
    }

    throw new BadRequestException({
      code: 'UNSUPPORTED_CONTRACT_VERSION',
      message: `Unsupported contract version: ${requestedVersion}`,
      supportedVersions: [CONTRACT_VERSION],
    });
  }
}
