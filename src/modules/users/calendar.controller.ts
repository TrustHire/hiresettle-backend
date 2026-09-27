import { Controller, Delete, Get, HttpCode, HttpStatus, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Response } from "express";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CalendarService } from "./calendar.service";

@ApiTags("users")
@Controller("users")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Post("me/calendar-token/regenerate")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Issue a new calendar feed token (invalidates the previous feed URL)",
  })
  @ApiResponse({ status: 200, description: "Raw token and feed path — shown once" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  regenerateToken(@CurrentUser("id") userId: string) {
    return this.calendar.regenerateToken(userId);
  }

  @Delete("me/calendar-token")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke the calendar feed token, disabling the feed" })
  @ApiResponse({ status: 200, description: "Token revoked" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  revokeToken(@CurrentUser("id") userId: string) {
    return this.calendar.revokeToken(userId);
  }

  // Authenticated by the feed token rather than a JWT: calendar clients
  // (Google, Outlook, Apple) can only subscribe to a plain URL.
  @Get("me/calendar.ics")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @ApiOperation({ summary: "iCalendar feed of upcoming milestone due dates" })
  @ApiQuery({ name: "token", required: true, description: "Calendar feed token" })
  @ApiProduces("text/calendar")
  @ApiResponse({ status: 200, description: "text/calendar (RFC 5545) feed" })
  @ApiResponse({ status: 401, description: "Missing, invalid or revoked token" })
  async feed(@Query("token") token: string, @Res() res: Response) {
    const ics = await this.calendar.renderFeed(token);
    res
      .status(HttpStatus.OK)
      .set({
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="hiresettle-milestones.ics"',
        "Cache-Control": "private, max-age=300",
      })
      .send(ics);
  }
}
