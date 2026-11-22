import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { CertificatesService } from './certificates.service';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Get(':id')
  async verify(@Param('id') id: string) {
    const certificate = await this.certificatesService.findById(id);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    const valid = this.certificatesService.verify(certificate);
    if (!valid) {
      throw new NotFoundException('Certificate verification failed');
    }

    return {
      id: certificate.id,
      engagementId: certificate.engagementId,
      company: certificate.confidential ? null : certificate.company,
      role: certificate.role,
      completedAt: certificate.completedAt,
      transactionHashes: certificate.transactionHashes,
      issuedAt: certificate.issuedAt,
      verified: true,
    };
  }
}
