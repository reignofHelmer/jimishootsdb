const sendEmail = require("./sendEmail");

const sendEmail = async ({ to, subject, html }) => {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: `"JimiShoots" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    replyTo: process.env.EMAIL_USER,
  });

  console.log("Email accepted by server:", info.accepted);
  console.log("Email rejected:", info.rejected);
};