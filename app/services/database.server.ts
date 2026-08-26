import mongoose, { type ConnectOptions } from "mongoose";

export type DatabaseConnectionCache<T> = {
  connection: T | null;
  promise: Promise<T> | null;
};

type DatabaseConnectionEventSource = {
  on(event: "close", listener: () => void): unknown;
};

const globalForDatabase = globalThis as typeof globalThis & {
  __moaDatabaseConnection?: DatabaseConnectionCache<typeof mongoose>;
  __moaDatabaseListenersAttached?: boolean;
};

const cache =
  globalForDatabase.__moaDatabaseConnection ??
  (globalForDatabase.__moaDatabaseConnection = {
    connection: null,
    promise: null,
  });

export const databaseConnectionOptions = {
  heartbeatFrequencyMS: 5_000,
  maxConnecting: 2,
  maxIdleTimeMS: 60_000,
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 30_000,
  waitQueueTimeoutMS: 15_000,
} satisfies ConnectOptions;

export async function connectWithCache<T>(
  connectionCache: DatabaseConnectionCache<T>,
  connect: () => Promise<T>
) {
  if (connectionCache.connection) return connectionCache.connection;

  if (!connectionCache.promise) {
    connectionCache.promise = connect().catch((error) => {
      connectionCache.promise = null;
      throw error;
    });
  }

  try {
    connectionCache.connection = await connectionCache.promise;
    return connectionCache.connection;
  } finally {
    connectionCache.promise = null;
  }
}

export function clearDatabaseConnectionCacheOnClose<T>(
  eventSource: DatabaseConnectionEventSource,
  connectionCache: DatabaseConnectionCache<T>
) {
  eventSource.on("close", () => {
    connectionCache.connection = null;
    connectionCache.promise = null;
  });
}

if (!globalForDatabase.__moaDatabaseListenersAttached) {
  // `disconnected` is a transient topology state. The MongoDB driver keeps the
  // existing client alive and reconnects it, so clearing the cache there would
  // let the next request create another MongoClient without closing the first.
  // Only an explicit close ends this client's lifecycle and permits a new one.
  clearDatabaseConnectionCacheOnClose(mongoose.connection, cache);
  globalForDatabase.__moaDatabaseListenersAttached = true;
}

export async function connectToDatabase() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error("MONGODB_URL must be configured before the server starts");
  }

  return connectWithCache(cache, () =>
    mongoose.connect(mongoUrl, databaseConnectionOptions)
  );
}
