import { Inject, UnauthorizedException } from "@nestjs/common";
import { Context, Resolver, Subscription } from "@nestjs/graphql";
import { Notification } from "@prisma/client";
import { PubSub } from "graphql-subscriptions";
import {
  NOTIFICATIONS_PUBSUB,
  NOTIFICATION_ADDED,
} from "../modules/notifications/notification-pubsub";
import { GraphqlNotification } from "./graphql.types";
import { GraphqlSubscriptionUser } from "./graphql-ws-auth";

interface NotificationAddedPayload {
  [NOTIFICATION_ADDED]: Notification;
}

interface SubscriptionContext {
  user?: GraphqlSubscriptionUser;
}

function isActive(user?: GraphqlSubscriptionUser): user is GraphqlSubscriptionUser {
  return !!user && (!user.exp || user.exp * 1000 > Date.now());
}

@Resolver(() => GraphqlNotification)
export class NotificationsResolver {
  constructor(@Inject(NOTIFICATIONS_PUBSUB) private readonly pubSub: PubSub) {}

  /**
   * Real-time notifications for the authenticated user over WebSocket
   * (graphql-ws), alongside the existing SSE stream (#408). Each subscriber
   * only receives their own notifications, and delivery stops once the
   * access token used to connect has expired.
   */
  @Subscription(() => GraphqlNotification, {
    filter: (payload: NotificationAddedPayload, _variables, context: SubscriptionContext) =>
      isActive(context.user) && payload[NOTIFICATION_ADDED].userId === context.user.id,
    resolve: (payload: NotificationAddedPayload): GraphqlNotification => {
      const notification = payload[NOTIFICATION_ADDED];
      return {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data == null ? null : JSON.stringify(notification.data),
        read: notification.read,
        createdAt: new Date(notification.createdAt),
      };
    },
  })
  notificationAdded(@Context() context: SubscriptionContext) {
    if (!isActive(context.user)) {
      throw new UnauthorizedException("Authentication required");
    }
    return this.pubSub.asyncIterator(NOTIFICATION_ADDED);
  }
}
