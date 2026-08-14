import { renderToStaticMarkup } from "react-dom/server";
import type { SendMailOptions } from "nodemailer";
import EmailOrderTemplate, {
  getOrderEmailSubject,
  getOrderEmailText,
  Template,
} from "~/components/mail/order";
import { theme } from "~/components/Theme";
import type { Order } from "~/types";
import { transporter } from "~/services/email-provider.server";

type MailSender = {
  sendMail(options: SendMailOptions): Promise<{ messageId?: string }>;
};

const emailKind = (template: Template) =>
  template === Template.ORDER ? "order" : "shipping";

export async function sendOrderEmail(
  order: Order,
  template: Template,
  mailer: MailSender = transporter
) {
  const markup = renderToStaticMarkup(
    <EmailOrderTemplate
      copyrightYear={new Date().getFullYear()}
      order={order}
      template={template}
    />
  );

  return mailer.sendMail({
    from: theme.email,
    to: order.customer.email,
    bcc: `${theme.email},wicket.programmer@gmail.com`,
    messageId: `<${emailKind(template)}-${String(order._id)}@moaclayco.com>`,
    subject: getOrderEmailSubject(order, template),
    text: getOrderEmailText(order, template),
    html: `<!doctype html>${markup}`,
  });
}
