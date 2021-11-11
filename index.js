require('@remix-run/node/globals').installGlobals()
const fs = require('fs')
const path = require('path')
const express = require('express')
const {createRequestHandler} = require('@remix-run/express')
const compression = require('compression')
const connector = require('./connector')
connector()

const MODE = process.env.NODE_ENV
const BUILD_DIR = path.join(process.cwd(), 'build')
let app = express()

app.use(compression())

app.use(express.static('public', {maxAge: '1w'}))

// If we ever change our font (which we quite possibly never will)
// then we'll just want to change the filename or something...
app.use(express.static('public/fonts', {immutable: true, maxAge: '1y'}))
// Remix fingerprints its assets so we can cache forever
app.use(express.static('public/images', {immutable: true, maxAge: '1y'}))
// Remix fingerprints its assets so we can cache forever
app.use(express.static('public/build', {immutable: true, maxAge: '1y'}))

// needs to handle all verbs (GET, POST, etc.)
app.all(
  '*',
  MODE === 'production'
    ? createRequestHandler({build: require('./build')})
    : (req, res, next) => {
        purgeRequireCache()
        const build = require('./build')
        return createRequestHandler({build, mode: MODE})(req, res, next)
      },
)

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  // preload the build so we're ready for the first request
  // we want the server to start accepting requests asap, so we wait until now
  // to preload the build
  require('./build')
  console.log(`Express server listening on port ${port}`)
})

function purgeRequireCache() {
  // purge require cache on requests for "server side HMR" this won't const
  // you have in-memory objects between requests in development,
  // alternatively you can set up nodemon/pm2-dev to restart the server on
  // file changes, we prefer the DX of this though, so we've included it
  // for you by default
  for (const key in require.cache) {
    if (key.startsWith(BUILD_DIR)) {
      delete require.cache[key]
    }
  }
}
