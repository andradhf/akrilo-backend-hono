import { createMiddleware } from 'hono/factory';
import { env } from '../lib/env';

const verifyCaptchaToken = async (token: string): Promise<boolean> => {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret:   env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  });
  const data = await res.json() as { success: boolean };
  return data.success === true;
};

export const captchaMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header('X-Captcha-Token');

  if (!token) {
    return c.json({ success: false, message: 'Captcha token required' }, 401);
  }

  const valid = await verifyCaptchaToken(token);
  if (!valid) {
    return c.json({ success: false, message: 'Invalid captcha' }, 403);
  }

  await next();
});
