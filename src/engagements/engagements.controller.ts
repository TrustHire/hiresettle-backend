import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EngagementsService } from './engagements.service';
import { ListEngagementsQueryDto } from './dto/list-engagements-query.dto';
import { CreateEngagementProposalDto } from './dto/create-engagement-proposal.dto';

@Controller('engagements')
@UseGuards(JwtAuthGuard)
export class EngagementsController {
  constructor(private readonly engagementsService: EngagementsService) {}

  @Get()
  async list(@Req() req, @Query() query: ListEngagementsQueryDto) {
    return this.engagementsService.list(req.user.companyId, query);
  }

  @Get('export.csv')
  async exportCsv(
    @Req() req,
    @Query() query: ListEngagementsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="engagements.csv"',
    );

    const stream = await this.engagementsService.streamCsv(
      req.user.companyId,
      query,
    );

    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(err);
      }
    });

    stream.pipe(res);
  }

  @Get(':id')
  async detail(@Req() req, @Param('id') id: string) {
    return this.engagementsService.getDetail(req.user.companyId, id);
  }

  @Post(':id/proposals')
  async createProposal(
    @Req() req,
    @Param('id') id: string,
    @Body() dto: CreateEngagementProposalDto,
  ) {
    return this.engagementsService.createProposal(req.user, id, dto);
  }

  @Post(':id/proposals/:proposalId/accept')
  async acceptProposal(
    @Req() req,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.engagementsService.acceptProposal(req.user, id, proposalId);
  }

  @Post(':id/proposals/:proposalId/reject')
  async rejectProposal(
    @Req() req,
    @Param('id') id: string,
    @Param('proposalId') proposalId: string,
  ) {
    return this.engagementsService.rejectProposal(req.user, id, proposalId);
  }
}
