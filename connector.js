import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URL

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local',
  )
}

let cached = global.mongoose

if (!cached) {
  cached = global.mongoose = {conn: null, promise: null}
}

async function dbConnect() {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    const opts = {
      minPoolSize: 4,
      maxPoolSize: 50,
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    }

    cached.promise = mongoose.connect(MONGODB_URI, opts).then(mongoose => {
      return mongoose
    })
  }
  cached.conn = await cached.promise
  return cached.conn
}

export default dbConnect