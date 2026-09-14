import nodemailer from 'nodemailer';
import { optionalIntEnv, requireEnv } from './env';

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Envoi SMTP classique ; identifiants dans les secrets GitHub. */
export function createSmtpMailer(): Mailer {
  const port = optionalIntEnv('MAIL_PORT', 587);
  const transport = nodemailer.createTransport({
    host: requireEnv('MAIL_HOST'),
    port,
    secure: port === 465,
    auth: { user: requireEnv('MAIL_USERNAME'), pass: requireEnv('MAIL_PASSWORD') },
  });
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}
