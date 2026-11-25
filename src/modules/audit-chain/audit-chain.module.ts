import { Module } from '@nestjs/common';
import { AuditChainController } from './audit-chain.controller';
import { AuditChainService } from './audit-chain.service';

@Module({
  controllers: [AuditChainController],
  providers: [AuditChainService],
  exports: [AuditChainService],
})
export class AuditChainModule {}
