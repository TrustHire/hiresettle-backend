import { PubSub } from "graphql-subscriptions";

/**
 * In-process PubSub used to fan notifications out to GraphQL subscribers
 * (#408). Like the SSE stream, it only reaches clients connected to the same
 * instance; swap for a Redis-backed PubSub if the API is scaled horizontally.
 */
export const NOTIFICATIONS_PUBSUB = "NOTIFICATIONS_PUBSUB";
export const NOTIFICATION_ADDED = "notificationAdded";

export const notificationsPubSubProvider = {
  provide: NOTIFICATIONS_PUBSUB,
  useValue: new PubSub(),
};
