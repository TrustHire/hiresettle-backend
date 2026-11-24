import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountingCategory, AccountingProvider, AccountingSyncStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertAccountMappingDto {
  @ApiProperty({ enum: AccountingCategory })
  @IsEnum(AccountingCategory)
  category: AccountingCategory;

  @ApiProperty({ example: '6100', description: 'Xero account code / QuickBooks account number' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  accountCode: string;
}

export class ListSyncLogsQueryDto {
  @ApiPropertyOptional({ enum: AccountingProvider })
  @IsOptional() @IsEnum(AccountingProvider)
  provider?: AccountingProvider;

  @ApiPropertyOptional({ enum: AccountingSyncStatus })
  @IsOptional() @IsEnum(AccountingSyncStatus)
  status?: AccountingSyncStatus;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'id of the last log from the previous page' })
  @IsOptional() @IsString()
  cursor?: string;
}
