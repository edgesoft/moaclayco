import nodemailer from "nodemailer";
import { themes } from "~/components/Theme";
import { getDomain } from "~/utils/domain";

type SendMail = {
  domainUrl: string;
  toAddress: string;
  subject: string;
  body: string;
};

export const transporter = nodemailer.createTransport({
  host: "send.one.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

export const sendEmail = async ({ domainUrl, toAddress, subject, body }: SendMail) => {

  const domain = getDomain(domainUrl)
  const theme = themes[domain?.domain || ""]

  try {
    await transporter.sendMail({
      from: theme.email,
      to: toAddress,
      bcc: "wicket.programmer@gmail.com",
      subject,
      html: body,
    });
  } catch (e) {
    console.log(e);
  }
};
