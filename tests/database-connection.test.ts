import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("the database pool keeps warm capacity and tolerates short bursts", () => {
  assert.ok(databaseConnectionOptions.minPoolSize >= 2);
  assert.ok(
    databaseConnectionOptions.maxPoolSize >=
      databaseConnectionOptions.minPoolSize * 5
  );
  assert.ok(databaseConnectionOptions.maxConnecting >= 4);
  assert.ok(databaseConnectionOptions.waitQueueTimeoutMS >= 15_000);
});
