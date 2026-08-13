import mongoose, { type ConnectOptions } from "mongoose";

export type DatabaseConnectionCache<T> = {
  connection: T | null;
  promise: Promise<T> | null;
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
  maxConnecting: 4,
  maxIdleTimeMS: 60_000,
  maxPoolSize: 20,
  minPoolSize: 2,
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

if (!globalForDatabase.__moaDatabaseListenersAttached) {
  mongoose.connection.on("disconnected", () => {
    cache.connection = null;
    cache.promise = null;
  });
  globalForDatabase.__moaDatabaseListenersAttached = true;
}

export async function connectToDatabase() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error("MONGODB_URL must be configured before the server starts");
  }

  if (cache.connection && mongoose.connection.readyState !== 1) {
    cache.connection = null;
    cache.promise = null;
  }

  return connectWithCache(cache, () =>
    mongoose.connect(mongoUrl, databaseConnectionOptions)
  );
}
