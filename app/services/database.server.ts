import mongoose from "mongoose";

export type DatabaseConnectionCache<T> = {
  connection: T | null;
  promise: Promise<T> | null;
};

const globalForDatabase = globalThis as typeof globalThis & {
  __moaDatabaseConnection?: DatabaseConnectionCache<typeof mongoose>;
};

const cache =
  globalForDatabase.__moaDatabaseConnection ??
  (globalForDatabase.__moaDatabaseConnection = {
    connection: null,
    promise: null,
  });

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

  connectionCache.connection = await connectionCache.promise;
  return connectionCache.connection;
}

export async function connectToDatabase() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error("MONGODB_URL must be configured before the server starts");
  }

  return connectWithCache(cache, () =>
    mongoose.connect(mongoUrl, {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 10_000,
      socketTimeoutMS: 45_000,
    })
  );
}
