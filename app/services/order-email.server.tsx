import { renderToStaticMarkup } from "react-dom/server";
import EmailOrderTemplate, {
  getOrderEmailSubject,
  getOrderEmailText,
  type Template,
} from "~/components/mail/order";
import { themes } from "~/components/Theme";
import type { Order } from "~/types";
import { transporter } from "~/services/email-provider.server";

export async function sendOrderEmail(order: Order, template: Template) {
  const theme = themes[order.domain] ?? themes.moaclayco;

  try {
    const markup = renderToStaticMarkup(
      <EmailOrderTemplate order={order} template={template} />
    );
    const info = await transporter.sendMail({
      from: theme.email,
      to: order.customer.email,
      bcc: `${theme.email},wicket.programmer@gmail.com`,
      subject: getOrderEmailSubject(order, template),
      text: getOrderEmailText(order, template),
      html: `<!doctype html>${markup}`,
    });

    console.log("Message sent: %s", info.messageId);
  } catch (error) {
    console.error("Order email could not be sent", error);
  }
}
