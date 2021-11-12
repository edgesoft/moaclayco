require('@remix-run/node/globals').installGlobals()
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

app.use(express.static('public/fonts', {immutable: true, maxAge: '1y'}))
app.use(express.static('public/images', {immutable: true, maxAge: '1y'}))
app.use(express.static('public/build', {immutable: true, maxAge: '1y'}))

app.all(
  '*',
  MODE === 'production'
    ? createRequestHandler({build: require(BUILD_DIR)})
    : (req, res, next) => {
        purgeRequireCache()
        const build = require(BUILD_DIR)
        return createRequestHandler({build, mode: MODE})(req, res, next)
      },
)

const port = process.env.PORT ?? 3001
app.listen(port, () => {
  require(BUILD_DIR)
  console.log(`Express server listening on port ${port}`)
})

function purgeRequireCache() {
  for (const key in require.cache) {
    if (key.startsWith(BUILD_DIR)) {
      delete require.cache[key]
    }
  }
}
