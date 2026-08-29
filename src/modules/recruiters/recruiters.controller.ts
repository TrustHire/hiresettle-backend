import {
  Controller, Get, Post, Delete, Query, Param, Body, UseGuards, HttpCode, HttpStatus,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes, ApiParam, ApiResponse,
} from '@nestjs/swagger';
import { RecruitersService } from './recruiters.service';
import { KycService } from './kyc.service';
import { RecruiterReviewsService } from './recruiter-reviews.service';
import { FavoritesService } from './favorites.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole, User } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { UserJwtSubThrottlerGuard } from '../../common/guards/user-jwt-sub-throttler.guard';
import { SearchRecruitersDto } from './dto/search-recruiters.dto';
import { CreateRecruiterReviewDto } from './dto/create-recruiter-review.dto';

@ApiTags('recruiters')
@ApiBearerAuth()
@UseGuards(UserJwtSubThrottlerGuard)
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 100, ttl: 60 } })
@Controller('recruiters')
export class RecruitersController {
  constructor(
    private readonly recruitersService: RecruitersService,
    private readonly kycService: KycService,
    private readonly reviewsService: RecruiterReviewsService,
    private readonly favoritesService: FavoritesService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recruiters with optional name search and pagination' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Case-insensitive partial match on recruiter name' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Results per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last recruiter from the previous page' })
  listRecruiters(@Query() query: SearchRecruitersDto) {
    return this.recruitersService.listRecruiters(query);
  }

  @Get('me/stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get recruiter performance stats including average rating' })
  getStats(@CurrentUser() user: User) {
    return this.recruitersService.getStats(user);
  }

  @Get('me/engagements')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get paginated list of recruiter engagements' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String, description: 'ID of the last engagement from the previous page' })
  getEngagements(
    @CurrentUser() user: User,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.recruitersService.getEngagements(user, page, limit, cursor);
  }

  @Get('me/kyc')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current recruiter KYC status and documents' })
  getMyKyc(@CurrentUser('id') userId: string) {
    return this.kycService.getMyKyc(userId);
  }

  @Post('me/kyc/documents')
  @UseGuards(RolesGuard)
  @Roles(UserRole.RECRUITER)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a KYC verification document (JPEG/PNG/GIF/PDF ≤ 10 MB)' })
  @ApiResponse({ status: 201, description: 'Document uploaded and KYC set to PENDING' })
  async submitKycDocument(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return this.kycService.submitDocument(userId, file);
  }

  @Post('reviews/:engagementId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a rating/review for a completed engagement (once per engagement)' })
  @ApiParam({ name: 'engagementId', description: 'Completed engagement ID' })
  @ApiResponse({ status: 201, description: 'Review created' })
  @ApiResponse({ status: 409, description: 'Review already exists for this engagement' })
  submitReview(
    @Param('engagementId') engagementId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateRecruiterReviewDto,
  ) {
    return this.reviewsService.submitReview(engagementId, user, dto);
  }

  @Get(':id/reviews')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List reviews for a recruiter (includes average rating in meta)' })
  @ApiParam({ name: 'id', description: 'Recruiter user ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listReviews(
    @Param('id') recruiterId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.reviewsService.listReviews(
      recruiterId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  /**
   * GET /api/v1/recruiters/favorites
   * List the current company's favorited recruiters.
   */
  @Get('favorites')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List favorited recruiters for the current company (COMPANY only)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listFavorites(
    @CurrentUser('id') companyId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.favoritesService.listFavorites(companyId, page ? Number(page) : 1, limit ? Number(limit) : 20);
  }

  /**
   * POST /api/v1/recruiters/:id/favorite
   * Add a recruiter to the current company's favorites.
   */
  @Post(':id/favorite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a recruiter to favorites (COMPANY only)' })
  @ApiParam({ name: 'id', description: 'Recruiter user ID' })
  @ApiResponse({ status: 201, description: 'Recruiter added to favorites' })
  @ApiResponse({ status: 409, description: 'Recruiter is already in favorites' })
  addFavorite(@CurrentUser('id') companyId: string, @Param('id') recruiterId: string) {
    return this.favoritesService.addFavorite(companyId, recruiterId);
  }

  /**
   * DELETE /api/v1/recruiters/:id/favorite
   * Remove a recruiter from the current company's favorites.
   */
  @Delete(':id/favorite')
  @UseGuards(RolesGuard)
  @Roles(UserRole.COMPANY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a recruiter from favorites (COMPANY only)' })
  @ApiParam({ name: 'id', description: 'Recruiter user ID' })
  @ApiResponse({ status: 200, description: 'Recruiter removed from favorites' })
  @ApiResponse({ status: 404, description: 'Recruiter is not in favorites' })
  removeFavorite(@CurrentUser('id') companyId: string, @Param('id') recruiterId: string) {
    return this.favoritesService.removeFavorite(companyId, recruiterId);
  }
}
