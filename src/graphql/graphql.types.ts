import {
  Field,
  GraphQLISODateTime,
  Int,
  ObjectType,
  registerEnumType,
} from "@nestjs/graphql";
import {
  EngagementStatus,
  MilestoneKind,
  MilestoneStatus,
  UserRole,
} from "@prisma/client";

registerEnumType(EngagementStatus, { name: "EngagementStatus" });
registerEnumType(MilestoneKind, { name: "MilestoneKind" });
registerEnumType(MilestoneStatus, { name: "MilestoneStatus" });
registerEnumType(UserRole, { name: "UserRole" });

@ObjectType()
export class GraphqlUser {
  @Field()
  id: string;

  @Field({ nullable: true })
  stellarAddress: string | null;

  @Field({ nullable: true })
  name: string | null;

  @Field({ nullable: true })
  company: string | null;

  @Field(() => UserRole)
  role: UserRole;

  @Field(() => GraphQLISODateTime, { nullable: true })
  verifiedAt: Date | null;
}

@ObjectType()
export class GraphqlMilestone {
  @Field()
  id: string;

  @Field(() => Int)
  milestoneIndex: number;

  @Field()
  name: string;

  @Field(() => MilestoneKind)
  kind: MilestoneKind;

  @Field(() => Int)
  paymentPercent: number;

  @Field({ nullable: true })
  amount: string | null;

  @Field(() => MilestoneStatus)
  status: MilestoneStatus;

  @Field({ nullable: true })
  proofHash: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  confirmedAt: Date | null;
}

@ObjectType()
export class GraphqlEngagement {
  @Field()
  id: string;

  @Field()
  companyAddress: string;

  @Field()
  recruiterAddress: string;

  @Field()
  arbiterAddress: string;

  @Field()
  tokenAddress: string;

  @Field()
  totalAmount: string;

  @Field()
  releasedAmount: string;

  @Field()
  jobTitle: string;

  @Field({ nullable: true })
  jobDescription: string | null;

  @Field({ nullable: true })
  salaryRange: string | null;

  @Field({ nullable: true })
  location: string | null;

  @Field(() => EngagementStatus)
  status: EngagementStatus;

  @Field(() => GraphqlUser)
  company: GraphqlUser;

  @Field(() => GraphqlUser)
  recruiter: GraphqlUser;

  @Field(() => GraphqlUser)
  arbiter: GraphqlUser;

  @Field(() => [GraphqlMilestone])
  milestones: GraphqlMilestone[];

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;
}
