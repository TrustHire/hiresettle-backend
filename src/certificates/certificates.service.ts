import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

export interface CertificateContent {
  engagementId: string;
  company: string;
  role: string;
  completedAt: string;
  txHashes: string[];
  confidential: boolean;
}

export interface PlacementCertificate {
  id: string;
  content: CertificateContent;
  signature: string;
  hidden: boolean;
  createdAt: string;
}

export interface PublicCertificate {
  id: string;
  company: string | null;
  role: string;
  completedAt: string;
  txHashes: string[];
  verified: boolean;
  createdAt: string;
}

@Injectable()
export class CertificatesService {
  private readonly certificates = new Map<string, PlacementCertificate>();

  private get platformKey(): string {
    return process.env.PLATFORM_SIGNING_KEY ?? '';
  }

  private serialize(content: CertificateContent): string {
    return JSON.stringify({
      engagementId: content.engagementId,
      company: content.company,
      role: content.role,
      completedAt: content.completedAt,
      txHashes: content.txHashes,
      confidential: content.confidential,
    });
  }

  private sign(content: CertificateContent): string {
    return createHmac('sha256', this.platformKey)
      .update(this.serialize(content))
      .digest('hex');
  }

  private verifySignature(certificate: PlacementCertificate): boolean {
    const expected = this.sign(certificate.content);
    const actual = certificate.signature ?? '';
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }

  generateCertificate(input: {
    engagementId: string;
    company: string;
    role: string;
    completedAt: string;
    txHashes: string[];
    confidential?: boolean;
  }): PlacementCertificate {
    if (!this.platformKey) {
      throw new BadRequestException('Platform signing key is not configured');
    }

    const content: CertificateContent = {
      engagementId: input.engagementId,
      company: input.company,
      role: input.role,
      completedAt: input.completedAt,
      txHashes: input.txHashes ?? [],
      confidential: input.confidential ?? false,
    };

    const certificate: PlacementCertificate = {
      id: this.buildId(input.engagementId),
      content,
      signature: this.sign(content),
      hidden: false,
      createdAt: new Date().toISOString(),
    };

    this.certificates.set(certificate.id, certificate);
    return certificate;
  }

  private buildId(engagementId: string): string {
    return createHmac('sha256', this.platformKey)
      .update(`certificate:${engagementId}`)
      .digest('hex')
      .slice(0, 32);
  }

  verify(id: string): PublicCertificate {
    const certificate = this.certificates.get(id);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }

    const verified = this.verifySignature(certificate);
    if (!verified) {
      throw new BadRequestException('Certificate verification failed');
    }

    return {
      id: certificate.id,
      company: certificate.content.confidential ? null : certificate.content.company,
      role: certificate.content.role,
      completedAt: certificate.content.completedAt,
      txHashes: certificate.content.txHashes,
      verified,
      createdAt: certificate.createdAt,
    };
  }

  setHidden(id: string, hidden: boolean): PlacementCertificate {
    const certificate = this.certificates.get(id);
    if (!certificate) {
      throw new NotFoundException('Certificate not found');
    }
    certificate.hidden = hidden;
    this.certificates.set(id, certificate);
    return certificate;
  }

  listForPortfolio(): PlacementCertificate[] {
    return Array.from(this.certificates.values()).filter((c) => !c.hidden);
  }
}
