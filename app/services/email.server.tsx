import { renderToString } from 'react-dom/server'
import type { SendEmailFunction } from 'remix-auth-email-link'
import * as emailProvider from './email-provider.server'
import { User } from '~/types'
import { getDomain } from '~/utils/domain'
import { themes } from '~/components/Theme'



export let sendEmail: SendEmailFunction<User> = async (options) => {

  const domain = getDomain(options.domainUrl)
  const theme = themes[domain?.domain || ""]

  let subject = `Länk till ${theme.title}`
  let body = renderToString(
    <p>
      Hej {options.user?.firstname} {options.user?.lastname},<br />
      <br />
      <a href={options.magicLink} target="_self">Klicka här för att logga in på {theme.title}</a>
    </p>
  )

  await emailProvider.sendEmail({domainUrl: options.domainUrl, toAddress: options.emailAddress, subject, body})
}