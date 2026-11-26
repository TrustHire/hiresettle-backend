import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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

  @Get(':id/candidates')
  async listCandidates(@Req() req, @Param('id') id: string) {
    return this.engagementsService.listCandidateSubmissions(req.user, id);
  }

  @Post(':id/candidates')
  async submitCandidate(
    @Req() req,
    @Param('id') id: string,
    @Body() body: SubmitCandidateDto,
  ) {
    return this.engagementsService.submitCandidate(req.user, id, body);
  }

  @Patch(':id/candidates/:candidateId/stage')
  async updateCandidateStage(
    @Req() req,
    @Param('id') id: string,
    @Param('candidateId') candidateId: string,
    @Body() body: UpdateCandidateStageDto,
  ) {
    return this.engagementsService.updateCandidateStage(
      req.user,
      id,
      candidateId,
      body,
    );
  }
}
