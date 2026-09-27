import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { join } from "path";
import { GraphqlResolver } from "./graphql.resolver";
import { NotificationsResolver } from "./notifications.resolver";
import { authenticateConnection } from "./graphql-ws-auth";
import { PrismaModule } from "../common/prisma/prisma.module";
import { NotificationsModule } from "../modules/notifications/notifications.module";

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const jwt = new JwtService({ secret: config.get<string>("JWT_SECRET") });
        return {
          autoSchemaFile: join(process.cwd(), "src/graphql/schema.gql"),
          sortSchema: true,
          playground: false,
          // WebSocket subscriptions (#408), authenticated with the same JWT
          // as REST, passed via connectionParams.authorization.
          subscriptions: {
            "graphql-ws": {
              path: "/graphql",
              onConnect: async (ctx: any) => {
                const user = await authenticateConnection(jwt, ctx.connectionParams);
                if (!user) return false; // closes the socket with 4403 Forbidden
                ctx.extra.user = user;
                return true;
              },
            },
          },
          context: ({ req, extra }: { req?: any; extra?: any }) =>
            extra ? { user: extra.user } : { req },
        };
      },
    }),
  ],
  providers: [GraphqlResolver, NotificationsResolver],
})
export class GraphqlModule {}
