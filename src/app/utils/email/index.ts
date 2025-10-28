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
};

export const sendCustomEmail = async (
  to: string,
  subject: string,
  message: string
): Promise<boolean> => {
  try {
    const { error } = await resend.emails.send({
      from: "Mateoz Shop <hola@mateozshop.com>",
      to: [to],
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Mateoz Shop</h1>
            <p style="color: #e0e7ff; margin: 10px 0 0 0; font-size: 16px;">Mensaje del equipo de administración</p>
          </div>
          
          <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
            <div style="color: #374151; line-height: 1.6; white-space: pre-wrap;">${message}</div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                Este mensaje fue enviado desde el panel de administración de Mateoz Shop.
              </p>
              <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0 0;">
                Si tienes alguna pregunta, puedes contactarnos respondiendo a este email.
              </p>
            </div>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error("Error sending custom email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Error sending custom email:", error);
    return false;
  }
};
