import { renderToString } from 'react-dom/server'
import type { SendEmailFunction } from 'remix-auth-email-link'
import * as emailProvider from './email-provider.server'
import { User } from '~/types'



export let sendEmail: SendEmailFunction<User> = async (options) => {
  let subject = "Länk till moaclayco.com"
  let body = renderToString(
    <p>
      Hej {options.user?.firstname} {options.user?.lastname},<br />
      <br />
      <a href={options.magicLink} target="_self">Klicka här för att logga in på moaclayco.com</a>
    </p>
  )

  await emailProvider.sendEmail({emailAddress: options.emailAddress, subject, body})
}