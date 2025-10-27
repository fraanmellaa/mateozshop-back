"use server";

import {
  REDEEM_PRODUCT_NO_DIRECT_REWARD,
  REDEEM_PRODUCT_WITH_DIRECT_REWARD,
} from "./templates";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async (
  to: string,
  type: string,
  code?: string
): Promise<boolean> => {
  let emailTemplate;

  return false;

  switch (type) {
    case "PRODUCT_NO_REWARD":
      emailTemplate = REDEEM_PRODUCT_NO_DIRECT_REWARD;
      break;

    case "PRODUCT_WITH_REWARD":
      emailTemplate = REDEEM_PRODUCT_WITH_DIRECT_REWARD;
      if (!code) return false;
      emailTemplate.html = emailTemplate.html.replace("{{CODE}}", code);
      break;
    default:
      break;
  }

  if (!emailTemplate) return false;

  try {
    const { error } = await resend.emails.send({
      from: "Mateoz Shop <hola@mateozshop.com>",
      to: [to],
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });
    if (error) {
      console.error("Error sending email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }

  return false;
};
