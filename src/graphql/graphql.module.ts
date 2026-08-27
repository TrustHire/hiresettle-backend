import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { join } from "path";
import { GraphqlResolver } from "./graphql.resolver";
import { PrismaModule } from "../common/prisma/prisma.module";

@Module({
  imports: [
    PrismaModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), "src/graphql/schema.gql"),
      sortSchema: true,
      playground: false,
    }),
  ],
  providers: [GraphqlResolver],
})
export class GraphqlModule {}
