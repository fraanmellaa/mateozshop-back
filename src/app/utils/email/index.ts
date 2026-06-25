"use server";

import {
  REDEEM_PRODUCT_NO_DIRECT_REWARD,
  REDEEM_PRODUCT_WITH_DIRECT_REWARD,
} from "./templates";
import { Resend } from "resend";

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new Resend(apiKey);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailLayout(params: {
  title: string;
  eyebrow?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}) {
  const cta =
    params.ctaLabel && params.ctaUrl
      ? `
        <div style="margin-top: 28px; text-align: center;">
          <a href="${escapeHtml(params.ctaUrl)}" style="display: inline-block; padding: 12px 20px; border-radius: 10px; background: #53fc18; color: #101010; font-weight: 700; text-decoration: none;">
            ${escapeHtml(params.ctaLabel)}
          </a>
        </div>
      `
      : "";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0f1220;">
      <div style="background: linear-gradient(135deg, #2f2179 0%, #161a2e 100%); padding: 32px 28px; border-radius: 18px 18px 0 0; border: 1px solid rgba(255,255,255,0.08); border-bottom: none;">
        <p style="margin: 0 0 12px; color: #53fc18; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
          ${escapeHtml(params.eyebrow || "Mateoz Shop")}
        </p>
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; line-height: 1.2;">
          ${escapeHtml(params.title)}
        </h1>
      </div>
      <div style="background: #ffffff; padding: 30px 28px; border-radius: 0 0 18px 18px; border: 1px solid rgba(15,18,32,0.08); box-shadow: 0 12px 30px rgba(0,0,0,0.18);">
        <div style="color: #374151; line-height: 1.7; font-size: 15px;">
          ${params.bodyHtml}
        </div>
        ${cta}
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; line-height: 1.6;">
          Este correo se ha enviado automaticamente desde Mateoz Shop.
        </div>
      </div>
    </div>
  `;
}

async function deliverEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  const resend = getResend();

  if (!resend) {
    console.error("RESEND_API_KEY not configured");
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: "Mateoz Shop <hola@mateozshop.com>",
      to: [params.to],
      subject: params.subject,
      html: params.html,
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
}

export const sendEmail = async (
  to: string,
  type: string,
  code?: string
): Promise<boolean> => {
  let emailTemplate: { subject: string; html: string } | null = null;

  switch (type) {
    case "PRODUCT_NO_REWARD":
      emailTemplate = REDEEM_PRODUCT_NO_DIRECT_REWARD;
      break;

    case "PRODUCT_WITH_REWARD":
      emailTemplate = {
        ...REDEEM_PRODUCT_WITH_DIRECT_REWARD,
        html: REDEEM_PRODUCT_WITH_DIRECT_REWARD.html,
      };
      if (!code) return false;
      emailTemplate.html = emailTemplate.html.replace(/\{\{code\}\}/i, code);
      break;
    default:
      break;
  }

  if (!emailTemplate) return false;

  return deliverEmail({
    to,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
  });
};

export const sendCustomEmail = async (
  to: string,
  subject: string,
  message: string
): Promise<boolean> => {
  return deliverEmail({
    to,
    subject,
    html: buildEmailLayout({
      title: subject,
      eyebrow: "Mensaje del equipo",
      bodyHtml: `<div style="white-space: pre-wrap;">${escapeHtml(message)}</div>`,
    }),
  });
};

export const sendWinnerNotificationEmail = async (params: {
  to: string;
  subject: string;
  title: string;
  intro: string;
  details?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
}) => {
  const detailsHtml = (params.details || [])
    .map(
      (detail) =>
        `<li style="margin: 0 0 8px;">${escapeHtml(detail)}</li>`
    )
    .join("");

  const bodyHtml = `
    <p style="margin-top: 0;">${escapeHtml(params.intro)}</p>
    ${detailsHtml ? `<ul style="padding-left: 20px; margin: 18px 0;">${detailsHtml}</ul>` : ""}
    <p style="margin-bottom: 0;">Revisa tu cuenta para ver todos los detalles.</p>
  `;

  return deliverEmail({
    to: params.to,
    subject: params.subject,
    html: buildEmailLayout({
      title: params.title,
      eyebrow: "Has ganado",
      bodyHtml,
      ctaLabel: params.ctaLabel,
      ctaUrl: params.ctaUrl,
    }),
  });
};
