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
  template === Template.ORDER
    ? "order"
    : template === Template.SPECIAL_INVITATION
      ? "special-order"
      : "shipping";

type OrderEmailOptions = {
  actionUrl?: string;
  deliveryAttempt?: number;
};

export const orderEmailRecipients = (
  order: Pick<Order, "customer">,
  environment: NodeJS.ProcessEnv = process.env
): Pick<SendMailOptions, "bcc" | "to"> => {
  const redirectedRecipient = environment.EMAIL_REDIRECT_TO?.trim();
  if (redirectedRecipient) return { to: redirectedRecipient };
  return {
    bcc: `${theme.email},wicket.programmer@gmail.com`,
    to: order.customer.email,
  };
};

export async function sendOrderEmail(
  order: Order,
  template: Template,
  mailer: MailSender = transporter,
  options: OrderEmailOptions = {}
) {
  const markup = renderToStaticMarkup(
    <EmailOrderTemplate
      actionUrl={options.actionUrl}
      copyrightYear={new Date().getFullYear()}
      order={order}
      template={template}
    />
  );

  return mailer.sendMail({
    from: theme.email,
    ...orderEmailRecipients(order),
    messageId: `<${emailKind(template)}-${String(order._id)}${
      options.deliveryAttempt && options.deliveryAttempt > 1
        ? `-${options.deliveryAttempt}`
        : ""
    }@moaclayco.com>`,
    subject: getOrderEmailSubject(order, template),
    text: getOrderEmailText(order, template, options.actionUrl),
    html: `<!doctype html>${markup}`,
  });
}
