/**
 * Server-Sent Events hub.
 *
 * Interface:
 *   hub.attach(req, res)  -> client   (writes headers, handles Last-Event-ID)
 *   client.send(event, data, {replay}) -> frame id
 *   hub.publish(dev, data)-> number of clients written to
 *   hub.close()
 *   hub.stats()
 *
 * Frames are `id`-numbered from a single process-level counter and kept in a
 * bounded ring, which is what makes `Last-Event-ID` reconnect meaningful: a
 * client that drops can ask for everything it missed. The trade-off is
 * deliberate and documented - the ring is per process, so a reconnect to a
 * *different* instance cannot replay and will be told so via a `resync` frame
 * followed by a full `snapshot`. Because every `snapshot` is a complete state,
 * a resync is always sufficient; replay is a nicety, not a correctness
 * requirement.
 */
export function createSseHub({ heartbeatMs = 15_000, replayBuffer = 100, logger } = {}) {
  const clients = new Set();
  const ring = [];
  let nextId = 1;
  let closed = false;

  const timer = setInterval(() => {
    const comment = `: heartbeat ${Date.now()}\n\n`;
    for (const client of clients) {
      if (!client.res.writableEnded) client.res.write(comment);
    }
  }, heartbeatMs);
  timer.unref?.();

  function record(dev, event, data) {
    const id = nextId;
    nextId += 1;
    if (replayBuffer > 0) {
      ring.push({ id, dev, event, data });
      if (ring.length > replayBuffer) ring.shift();
    }
    return id;
  }

  return {
    get clientCount() {
      return clients.size;
    },

    attach(req, res) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      // Advise the browser's default reconnect delay; the client is free to
      // change it, and the heartbeat comment below detects a dead link.
      res.write('retry: 3000\n\n');

      const lastEventId = Number.parseInt(req.get('last-event-id') ?? '', 10);
      if (Number.isInteger(lastEventId) && lastEventId > 0) {
        const oldest = ring.length > 0 ? ring[0].id : nextId;
        if (lastEventId >= oldest - 1) {
          for (const frame of ring) {
            if (frame.id <= lastEventId) continue;
            if (frame.dev !== null && frame.dev !== req.query.dev) continue;
            res.write(`id: ${frame.id}\nevent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
          }
        } else {
          res.write(
            `id: ${nextId}\nevent: resync\ndata: ${JSON.stringify({ reason: 'replay_buffer_exceeded', last_event_id: lastEventId })}\n\n`,
          );
        }
      }

      const client = {
        res,
        dev: typeof req.query.dev === 'string' ? req.query.dev : null,
        send(name, data, { replay = true } = {}) {
          if (res.writableEnded) return null;
          const id = replay ? record(this.dev, name, data) : nextId++;
          res.write(`id: ${id}\nevent: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
          res.flush?.();
          return id;
        },
        close() {
          clients.delete(client);
        },
      };

      const drop = () => {
        clients.delete(client);
      };
      res.on('close', drop);
      res.on('error', drop);
      clients.add(client);
      logger?.debug?.('sse client attached', { dev: client.dev, clients: clients.size });
      return client;
    },

    /** Publish a full state snapshot to every client subscribed to `dev`. */
    publish(dev, data) {
      let written = 0;
      for (const client of clients) {
        if (client.dev !== null && client.dev !== dev) continue;
        const id = record(dev, 'snapshot', data);
        client.res.write(`id: ${id}\nevent: snapshot\ndata: ${JSON.stringify(data)}\n\n`);
        client.res.flush?.();
        written += 1;
      }
      return written;
    },

    stats() {
      return { clients: clients.size, buffered_frames: ring.length, next_id: nextId };
    },

    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const client of clients) {
        client.res.write('event: shutdown\ndata: {"reason":"server_stopping"}\n\n');
        client.res.end();
      }
      clients.clear();
    },
  };
}
