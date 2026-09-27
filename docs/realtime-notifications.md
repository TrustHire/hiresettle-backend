# Realtime Notifications (SSE)

The backend exposes a Server-Sent Events (SSE) stream so clients can receive
notifications in realtime without polling.

## Endpoint

```
GET /notifications/stream
```

- **Auth:** required. The stream is scoped to the authenticated user.
- **Content-Type:** `text/event-stream`
- **Cache-Control:** `no-cache`
- **Connection:** `keep-alive`

## Authenticating the stream

`EventSource` cannot set custom request headers, so the access token is passed
as a query parameter. The server also accepts the standard `Authorization`
header for non-browser clients (e.g. `curl`, Node).

```
GET /notifications/stream?token=<access_token>
```

> Treat the token in the URL as sensitive: it can appear in server logs and
> browser history. Use short-lived access tokens and refresh them before
> reconnecting.

## Browser client example

```html
<!doctype html>
<html>
  <body>
    <ul id="notifications"></ul>

    <script>
      const list = document.getElementById('notifications');

      function render(notification) {
        const item = document.createElement('li');
        item.textContent = `[${notification.type}] ${notification.title}`;
        list.prepend(item);
      }

      function connect(accessToken) {
        const url = `/notifications/stream?token=${encodeURIComponent(accessToken)}`;
        const source = new EventSource(url);

        // Default event: a notification payload.
        source.onmessage = (event) => {
          render(JSON.parse(event.data));
        };

        // Named event: server heartbeat / keep-alive.
        source.addEventListener('heartbeat', () => {
          // No-op: receiving this confirms the connection is alive.
        });

        source.onerror = () => {
          // EventSource reconnects automatically. If the token expired the
          // server closes the stream, so refresh and reconnect manually.
          source.close();
          refreshAccessToken().then(connect);
        };

        return source;
      }

      // Kick off the stream with a fresh access token.
      refreshAccessToken().then(connect);
    </script>
  </body>
</html>
```

## Event payload format

Each notification is sent as a JSON object in the `data` field of a default
(`message`) event:

```json
{
  "id": "b3f1c2e4-9a7d-4c1e-8f2a-1d5e6b7c8a90",
  "type": "engagement.created",
  "title": "New engagement",
  "body": "Acme Corp created a new engagement.",
  "data": { "engagementId": "eng_123" },
  "createdAt": "2024-05-01T12:34:56.789Z",
  "read": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique notification identifier. |
| `type` | string | Event type, e.g. `engagement.created`, `milestone.funded`. |
| `title` | string | Short human-readable summary. |
| `body` | string | Longer description of the event. |
| `data` | object | Event-specific payload (IDs, amounts, etc.). |
| `createdAt` | string | ISO-8601 timestamp of when the event occurred. |
| `read` | boolean | Whether the notification has been read. |

Heartbeats are sent as a named `heartbeat` event with an empty payload and are
not notifications:

```
event: heartbeat
data: {}
```

## Reconnect and heartbeat behaviour

- **Heartbeat:** the server emits a `heartbeat` event roughly every 30 seconds
  to keep proxies and load balancers from closing an idle connection. Clients
  can ignore the payload; receiving it confirms the stream is healthy.
- **Automatic reconnect:** `EventSource` reconnects automatically after a
  dropped connection. The server sends a `retry:` hint (in milliseconds) to
  control the backoff interval.
- **Token expiry:** when the access token expires the server closes the stream.
  `EventSource` will retry with the same (now invalid) URL, so close the source
  and reconnect with a freshly refreshed token, as shown in the example above.
- **Clean shutdown:** call `source.close()` when the user logs out or the page
  unloads to release the connection.
