import { Args, Int, Query, Resolver } from "@nestjs/graphql";
import { EngagementStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import {
  GraphqlEngagement,
  GraphqlMilestone,
  GraphqlUser,
} from "./graphql.types";

const userSelect = {
  id: true,
  stellarAddress: true,
  name: true,
  company: true,
  role: true,
  verifiedAt: true,
} satisfies Prisma.UserSelect;

const engagementInclude = {
  company: { select: userSelect },
  recruiter: { select: userSelect },
  arbiter: { select: userSelect },
  milestones: { orderBy: { milestoneIndex: "asc" as const } },
} satisfies Prisma.EngagementInclude;

function serializeEngagement(engagement: any): GraphqlEngagement {
  return {
    ...engagement,
    totalAmount: engagement.totalAmount.toString(),
    releasedAmount: engagement.releasedAmount.toString(),
    milestones: engagement.milestones.map((milestone: any) => ({
      ...milestone,
      amount: milestone.amount?.toString() ?? null,
    })),
  } as GraphqlEngagement;
}

@Resolver()
export class GraphqlResolver {
  constructor(private readonly prisma: PrismaService) {}

  @Query(() => [GraphqlUser])
  users(): Promise<GraphqlUser[]> {
    return this.prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: "desc" },
    });
  }

  @Query(() => GraphqlUser, { nullable: true })
  user(
    @Args("stellarAddress") stellarAddress: string,
  ): Promise<GraphqlUser | null> {
    return this.prisma.user.findUnique({
      where: { stellarAddress },
      select: userSelect,
    });
  }

  @Query(() => [GraphqlEngagement])
  async engagements(
    @Args("status", { type: () => EngagementStatus, nullable: true })
    status?: EngagementStatus,
    @Args("skip", { type: () => Int, nullable: true, defaultValue: 0 })
    skip = 0,
    @Args("take", { type: () => Int, nullable: true, defaultValue: 20 })
    take = 20,
  ): Promise<GraphqlEngagement[]> {
    const engagements = (await this.prisma.engagement.findMany({
      where: status ? { status } : undefined,
      include: engagementInclude,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    })) as unknown as GraphqlEngagement[];
    return engagements.map(serializeEngagement);
  }

  @Query(() => GraphqlEngagement, { nullable: true })
  async engagement(@Args("id") id: string): Promise<GraphqlEngagement | null> {
    const engagement = await this.prisma.engagement.findUnique({
      where: { id },
      include: engagementInclude,
    });
    if (!engagement) return null;
    return serializeEngagement(engagement);
  }

  @Query(() => [GraphqlMilestone])
  async milestones(
    @Args("engagementId", { nullable: true }) engagementId?: string,
  ): Promise<GraphqlMilestone[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: engagementId ? { engagementId } : undefined,
      orderBy: [{ engagementId: "asc" }, { milestoneIndex: "asc" }],
    });
    return milestones.map((milestone) => ({
      ...milestone,
      amount: milestone.amount?.toString() ?? null,
    })) as unknown as GraphqlMilestone[];
  }
}
