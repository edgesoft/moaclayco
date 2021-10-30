import faunadb from 'faunadb'

const client = new faunadb.Client({
  secret: process.env.FAUNA_SECRET_KEY || '',
  domain: 'db.eu.fauna.com',
})

export default client
