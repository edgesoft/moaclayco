import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDatabaseConnectionCacheOnClose,
  connectWithCache,
  databaseConnectionOptions,
  type DatabaseConnectionCache,
} from "../app/services/database.server";

const emptyCache = <T>(): DatabaseConnectionCache<T> => ({
  connection: null,
  promise: null,
});

test("database connection attempts are shared while they are pending", async () => {
  const cache = emptyCache<{ connected: true }>();
  let attempts = 0;
  const connect = async () => {
    attempts += 1;
    return { connected: true as const };
  };

  const [first, second] = await Promise.all([
    connectWithCache(cache, connect),
    connectWithCache(cache, connect),
  ]);

  assert.equal(attempts, 1);
  assert.equal(first, second);
  assert.equal(cache.promise, null);
});

test("a failed database connection can be retried", async () => {
  const cache = emptyCache<{ connected: true }>();
  let attempts = 0;
  const connect = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary network failure");
    return { connected: true as const };
  };

  await assert.rejects(connectWithCache(cache, connect), /temporary network/);
  const connection = await connectWithCache(cache, connect);

  assert.equal(attempts, 2);
  assert.equal(connection.connected, true);
  assert.equal(cache.promise, null);
});

test("a resolved database client remains the only client for the process", async () => {
  const existing = { connected: true as const };
  const cache: DatabaseConnectionCache<typeof existing> = {
    connection: existing,
    promise: null,
  };
  let attempts = 0;

  const connection = await connectWithCache(cache, async () => {
    attempts += 1;
    return { connected: true as const };
  });

  assert.equal(connection, existing);
  assert.equal(attempts, 0);
});

test("only an explicit close clears the cached database client", () => {
  const existing = { connected: true as const };
  const cache: DatabaseConnectionCache<typeof existing> = {
    connection: existing,
    promise: Promise.resolve(existing),
  };
  let subscribedEvent: string | undefined;
  let closeListener: (() => void) | undefined;

  clearDatabaseConnectionCacheOnClose(
    {
      on(event, listener) {
        subscribedEvent = event;
        closeListener = listener;
      },
    },
    cache
  );

  assert.equal(subscribedEvent, "close");
  assert.equal(cache.connection, existing);
  closeListener?.();
  assert.equal(cache.connection, null);
  assert.equal(cache.promise, null);
});

test("the database pool releases idle capacity and bounds short bursts", () => {
  assert.equal(databaseConnectionOptions.minPoolSize, 0);
  assert.equal(databaseConnectionOptions.maxPoolSize, 10);
  assert.equal(databaseConnectionOptions.maxConnecting, 2);
  assert.equal(databaseConnectionOptions.maxIdleTimeMS, 60_000);
  assert.ok(databaseConnectionOptions.waitQueueTimeoutMS >= 15_000);
});
