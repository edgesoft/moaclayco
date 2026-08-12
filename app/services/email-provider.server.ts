import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  host: "send.one.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});
