import nodemailer from "nodemailer";

type SendMail = {
  emailAddress: string;
  subject: string;
  body: string;
};

export const sendEmail = async ({ emailAddress, subject, body }: SendMail) => {
  let transporter = nodemailer.createTransport({
    host: "send.one.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  try {
    let info = await transporter.sendMail({
      from: "support@moaclayco.com",
      to: emailAddress,
      bcc: "wicket.programmer@gmail.com",
      subject,
      html: body,
    });
    console.log(info);
  } catch (e) {
    console.log(e);
  }
};
