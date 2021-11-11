const mongoose = require('mongoose')

const MONGODB_URI = process.env.MONGODB_URL

if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local',
  )
}
/**
const connectionStatus = {
  connected: false,
}

if (process.env.NODE_ENV !== 'test') {
  const mongoose = require('mongoose')
  mongoose.Promise = Promise

  mongoose
    .connect(process.env.MONGODB_URL, {
      minPoolSize: 2,
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    })
    .catch(() => {
      console.log(
        'error',
        'Could not get initial connection to MongoDB...Exiting...',
      )
      process.exit()
    })

  mongoose.connection.on('error', function () {
    console.log('error', 'Could not connect to MongoDB...')
  })

  mongoose.connection.on('disconnected', function () {
    connectionStatus.connected = false
    console.log('error', 'Lost MongoDB connection...Trying to reconnect...')
  })

  mongoose.connection.on('connected', function () {
    connectionStatus.connected = true
    console.log('info', 'Connection established to MongoDB')
  })

  mongoose.connection.on('reconnected', function () {
    connectionStatus.connected = true
    console.log('info', 'Reconnected to MongoDB')
  })

  mongoose.connection.on('reconnectFailed', function () {
    console.log('error', 'Reconnect to MongoDB failed. Exiting...')
    process.exit()
  })

  process.on('SIGINT', () => {
    mongoose.disconnect()
    process.exit()
  })
}

import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI


if (!MONGODB_URI) {
  throw new Error(
    'Please define the MONGODB_URI environment variable inside .env.local',
  )
}
 */

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 */
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
      minPoolSize: 2,
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

module.exports = dbConnect
