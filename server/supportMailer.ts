import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export const OFFICIAL_SUPPORT_EMAIL = 'charaiva10@gmail.com';

export type SupportFeedbackType = 'problem' | 'suggestion' | 'incorrect_info';

export const FEEDBACK_TYPE_LABELS: Record<SupportFeedbackType, string> = {
  problem: 'Report a Problem',
  suggestion: 'Share Feedback or Suggestion',
  incorrect_info: 'Report Incorrect Information',
};

export const SUPPORT_RELATED_FEATURES = [
  'General App',
  'Explore Home & City Guide',
  'Photo Guide & OCR',
  'Discover Search',
  'Nearby Attractions',
  'AI Guide Chat',
  'Interactive Map',
  'Tour Journal',
  'Settings, Voice & Language',
] as const;

export type SupportRelatedFeature = (typeof SUPPORT_RELATED_FEATURES)[number];

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MB
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 3000;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_SUCCESS_PER_WINDOW = 5;
const MAX_ATTEMPTS_PER_WINDOW = 20;
const DUPLICATE_COOLDOWN_MS = 30_000;

export type SupportErrorCode =
  | 'SPAM_TRIGGERED'
  | 'INVALID_FEEDBACK_TYPE'
  | 'MESSAGE_TOO_SHORT'
  | 'INVALID_EMAIL'
  | 'INVALID_SCREENSHOT'
  | 'AUTH_ERROR'
  | 'DUPLICATE_ALREADY_ACCEPTED'
  | 'RATE_LIMITED'
  | 'MAIL_NOT_CONFIGURED'
  | 'SMTP_AUTH_FAILED'
  | 'SMTP_RECIPIENT_REJECTED'
  | 'SMTP_DELIVERY_FAILED'
  | 'RESEND_DELIVERY_FAILED';

export class SupportValidationError extends Error {
  code: SupportErrorCode;
  constructor(code: SupportErrorCode, message: string) {
    super(message);
    this.name = 'SupportValidationError';
    this.code = code;
  }
}

const ipSuccessWindow = new Map<string, number[]>();
const ipAttemptWindow = new Map<string, number[]>();
const recentSuccessfulDedupeMap = new Map<string, number>();

export function sanitizeSingleLine(raw: unknown, maxLen: number = 160): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function sanitizeMultilineMessage(raw: unknown, maxLen: number = MAX_MESSAGE_LENGTH): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

export function isValidSupportEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 160 || /[\r\n]/.test(email)) return false;
  return /^[^\s@<>()[\]\\,;:\s"]+@[^\s@<>()[\]\\,;:\s"]+\.[^\s@<>()[\]\\,;:\s"]{2,}$/.test(email);
}

export interface DecodedScreenshotAttachment {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  filename: string;
  buffer: Buffer;
}

export function validateAndDecodeScreenshot(rawDataUrl: unknown): DecodedScreenshotAttachment | null {
  if (rawDataUrl === undefined || rawDataUrl === null || rawDataUrl === '') {
    return null;
  }
  if (typeof rawDataUrl !== 'string') {
    throw new SupportValidationError('INVALID_SCREENSHOT', 'Invalid screenshot payload.');
  }
  const match = rawDataUrl.trim().match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) {
    throw new SupportValidationError('INVALID_SCREENSHOT', 'Screenshot must be a PNG, JPEG, or WebP image.');
  }
  const normalizedMime = (match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase()) as
    | 'image/png'
    | 'image/jpeg'
    | 'image/webp';
  const ext = normalizedMime === 'image/png' ? 'png' : normalizedMime === 'image/webp' ? 'webp' : 'jpg';
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) {
    throw new SupportValidationError('INVALID_SCREENSHOT', 'Screenshot image must be smaller than 2 MB.');
  }
  return {
    mimeType: normalizedMime,
    filename: `charaiva-feedback-screenshot.${ext}`,
    buffer,
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSupportMailtoUrl(params: {
  feedbackType: SupportFeedbackType;
  relatedFeature: string;
  replyEmail: string;
  message: string;
  submittedAtIso: string;
  userStatusLabel: string;
  hasScreenshot?: boolean;
}): string {
  const typeLabel = FEEDBACK_TYPE_LABELS[params.feedbackType] || params.feedbackType;
  const subject = `[Charaiva ${typeLabel}] ${params.relatedFeature}`;
  const bodyLines = [
    `Feedback Type: ${typeLabel}`,
    `Related Feature: ${params.relatedFeature}`,
    `Reply-To Email: ${params.replyEmail} (${params.userStatusLabel})`,
    `Submitted At (UTC): ${params.submittedAtIso}`,
    ...(params.hasScreenshot
      ? ['Note: Please attach your selected screenshot in your email app before sending.']
      : []),
    '',
    'Message:',
    params.message,
  ];
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(bodyLines.join('\n').slice(0, 1600));
  return `mailto:${OFFICIAL_SUPPORT_EMAIL}?subject=${encodedSubject}&body=${encodedBody}`;
}

function buildDedupeKey(email: string, message: string): string {
  return `${email.trim().toLowerCase()}::${message.trim().slice(0, 120).toLowerCase()}`;
}

export function checkSupportRateLimitBeforeSend(
  ipKey: string,
  email: string,
  message: string
): { allowed: boolean; errorCode?: SupportErrorCode; reason?: string } {
  const now = Date.now();
  const normalizedIp = (ipKey || 'unknown').slice(0, 80);

  // Only block duplicate identical submissions if a previous identical message was ACCEPTED by a delivery provider
  const dedupeKey = buildDedupeKey(email, message);
  const lastDeliveredAt = recentSuccessfulDedupeMap.get(dedupeKey);
  if (lastDeliveredAt && now - lastDeliveredAt < DUPLICATE_COOLDOWN_MS) {
    return {
      allowed: false,
      errorCode: 'DUPLICATE_ALREADY_ACCEPTED',
      reason:
        'An identical feedback message was already accepted by the mail server within the last 30 seconds. Please wait 30 seconds before sending it again.',
    };
  }

  const successTimestamps = (ipSuccessWindow.get(normalizedIp) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (successTimestamps.length >= MAX_SUCCESS_PER_WINDOW) {
    return {
      allowed: false,
      errorCode: 'RATE_LIMITED',
      reason: 'Too many feedback submissions in a short period. Please wait a few minutes before trying again.',
    };
  }

  const attemptTimestamps = (ipAttemptWindow.get(normalizedIp) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (attemptTimestamps.length >= MAX_ATTEMPTS_PER_WINDOW) {
    return {
      allowed: false,
      errorCode: 'RATE_LIMITED',
      reason: 'Too many submission attempts in a short period. Please wait a few minutes before trying again.',
    };
  }

  attemptTimestamps.push(now);
  ipAttemptWindow.set(normalizedIp, attemptTimestamps);

  return { allowed: true };
}

export function recordSupportSubmissionOutcome(
  ipKey: string,
  email: string,
  message: string,
  delivered: boolean
): void {
  if (!delivered) {
    // Do NOT record failed or unconfigured attempts as submitted — retries must never be blocked as duplicates.
    return;
  }
  const now = Date.now();
  const normalizedIp = (ipKey || 'unknown').slice(0, 80);
  const successTimestamps = (ipSuccessWindow.get(normalizedIp) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  successTimestamps.push(now);
  ipSuccessWindow.set(normalizedIp, successTimestamps);

  const dedupeKey = buildDedupeKey(email, message);
  recentSuccessfulDedupeMap.set(dedupeKey, now);

  if (recentSuccessfulDedupeMap.size > 500) {
    for (const [k, ts] of recentSuccessfulDedupeMap.entries()) {
      if (now - ts >= 60_000) recentSuccessfulDedupeMap.delete(k);
    }
  }
}

export function checkSupportRateLimit(
  ipKey: string,
  email: string,
  message: string
): { allowed: boolean; errorCode?: SupportErrorCode; reason?: string } {
  const preCheck = checkSupportRateLimitBeforeSend(ipKey, email, message);
  if (preCheck.allowed) {
    recordSupportSubmissionOutcome(ipKey, email, message, true);
  }
  return preCheck;
}

export function resetSupportRateLimitsForTests(): void {
  ipSuccessWindow.clear();
  ipAttemptWindow.clear();
  recentSuccessfulDedupeMap.clear();
}

export async function verifyFirebaseIdTokenEmail(
  idToken: string,
  firebaseWebApiKey: string
): Promise<{ verifiedEmail: string | null; uid: string | null }> {
  const cleanToken = idToken.trim();
  if (!cleanToken || !firebaseWebApiKey) {
    return { verifiedEmail: null, uid: null };
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseWebApiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: cleanToken }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error('Could not verify authenticated user session.');
  }
  const data = await res.json();
  const user = Array.isArray(data?.users) ? data.users[0] : null;
  if (!user || !user.email) {
    throw new Error('Authenticated session does not include a verified email.');
  }
  return {
    verifiedEmail: String(user.email).trim(),
    uid: user.localId ? String(user.localId) : null,
  };
}

export interface SupportFeedbackInput {
  feedbackType: unknown;
  relatedFeature: unknown;
  message: unknown;
  replyEmail: unknown;
  language?: unknown;
  screenshotDataUrl?: unknown;
  honeypot?: unknown;
  isSignedInSession: boolean;
  verifiedSessionEmail?: string | null;
}

export interface SupportDeliveryOutcome {
  delivered: boolean;
  deliveryStatus: 'sent' | 'not_configured' | 'delivery_failed';
  deliveryStage?: 'provider_accepted' | 'not_accepted';
  provider?: 'smtp' | 'resend';
  recipient: string;
  replyEmail: string;
  submittedAt: string;
  mailtoUrl: string;
  messageId?: string;
  acceptedRecipients?: string[];
  providerResponse?: string;
  missingConfig?: string[];
  errorCode?: SupportErrorCode;
  error?: string;
}

export function cleanEnvValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function resolveSupportRecipient(env: NodeJS.ProcessEnv): {
  recipient: string;
  envConfiguredCorrectly: boolean;
} {
  const raw = cleanEnvValue(env.SUPPORT_RECIPIENT_EMAIL);
  if (!raw) {
    return {
      recipient: OFFICIAL_SUPPORT_EMAIL,
      envConfiguredCorrectly: false,
    };
  }
  if (raw.toLowerCase() !== OFFICIAL_SUPPORT_EMAIL) {
    console.warn(
      `[SupportMailer] SUPPORT_RECIPIENT_EMAIL was set to unexpected value; enforcing official recipient ${OFFICIAL_SUPPORT_EMAIL}.`
    );
    return {
      recipient: OFFICIAL_SUPPORT_EMAIL,
      envConfiguredCorrectly: false,
    };
  }
  return {
    recipient: OFFICIAL_SUPPORT_EMAIL,
    envConfiguredCorrectly: true,
  };
}

export function resolveSmtpConfig(env: NodeJS.ProcessEnv): {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  configured: boolean;
  missingFields: string[];
} {
  const host = cleanEnvValue(env.SMTP_HOST);
  const user = cleanEnvValue(env.SMTP_USER).replace(/^<(.+)>$/, '$1').trim();
  let pass = cleanEnvValue(env.SMTP_PASS);

  // Google App Passwords are often copied as 4 groups of 4 chars separated by spaces, NBSP, or hyphens
  const lowerHost = host.toLowerCase();
  if (
    (lowerHost.includes('gmail.com') || lowerHost.includes('googlemail.com')) &&
    /^[a-z0-9]{4}(?:[\s\-\u00A0]+[a-z0-9]{4}){3}$/i.test(pass)
  ) {
    pass = pass.replace(/[\s\-\u00A0]+/g, '');
  }

  const parsedPort = Number(cleanEnvValue(env.SMTP_PORT));
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587;
  const rawSecure = cleanEnvValue(env.SMTP_SECURE).toLowerCase();
  // Port 465 uses implicit TLS (secure: true); port 587 uses STARTTLS (secure: false)
  const secure = port === 465 ? true : port === 587 ? false : rawSecure === 'true';

  const from = cleanEnvValue(env.SMTP_FROM) || user || 'support@charaiva.app';
  const missingFields: string[] = [];
  if (!host) missingFields.push('SMTP_HOST');
  if (!user) missingFields.push('SMTP_USER');
  if (!pass) missingFields.push('SMTP_PASS');

  const configured = missingFields.length === 0;

  return { host, port, secure, user, pass, from, configured, missingFields };
}

export function formatSenderAddress(rawFrom: string): string {
  const trimmed = cleanEnvValue(rawFrom).replace(/[\r\n\u0000-\u001F\u007F]/g, ' ').trim();
  if (!trimmed) return 'Charaiva Help & Support <support@charaiva.app>';
  const bracketMatch = trimmed.match(/^([^<>]*?)<\s*([^\s<>]+@[^\s<>]+)\s*>$/);
  if (bracketMatch) {
    const displayName = sanitizeSingleLine(bracketMatch[1], 80);
    const email = sanitizeSingleLine(bracketMatch[2], 120);
    return displayName ? `${displayName} <${email}>` : `Charaiva Help & Support <${email}>`;
  }
  const emailOnly = sanitizeSingleLine(trimmed, 160);
  if (!emailOnly) return 'Charaiva Help & Support <support@charaiva.app>';
  return `Charaiva Help & Support <${emailOnly}>`;
}

export function resolveMailConfigDiagnostics(env: NodeJS.ProcessEnv): {
  smtpConfigured: boolean;
  resendConfigured: boolean;
  recipient: string;
  missingConfig: string[];
} {
  const smtp = resolveSmtpConfig(env);
  const resendApiKey = cleanEnvValue(env.RESEND_API_KEY);
  const resendFrom = cleanEnvValue(env.RESEND_FROM);
  const resendConfigured = Boolean(resendApiKey && resendFrom);
  const { recipient } = resolveSupportRecipient(env);

  const missingConfig: string[] = [];
  if (!smtp.configured && !resendConfigured) {
    // If Resend is partially configured, report its missing key; otherwise report SMTP missing keys
    if (resendApiKey && !resendFrom) {
      missingConfig.push('RESEND_FROM');
    } else if (!resendApiKey && resendFrom) {
      missingConfig.push('RESEND_API_KEY');
    } else {
      missingConfig.push(...smtp.missingFields);
    }
  }
  return {
    smtpConfigured: smtp.configured,
    resendConfigured,
    recipient,
    missingConfig,
  };
}

function isSmtpAuthError(err: any): boolean {
  const code = String(err?.code || '').toUpperCase();
  const responseCode = Number(err?.responseCode);
  const msg = String(err?.message || err?.response || '');
  return (
    code === 'EAUTH' ||
    responseCode === 535 ||
    /535|Invalid login|Username and Password not accepted|Authentication failed/i.test(msg)
  );
}

export function validateSupportFeedbackPayload(input: SupportFeedbackInput): {
  feedbackType: SupportFeedbackType;
  relatedFeature: string;
  message: string;
  replyEmail: string;
  language: string;
  screenshot: DecodedScreenshotAttachment | null;
} {
  if (typeof input.honeypot === 'string' && input.honeypot.trim().length > 0) {
    throw new SupportValidationError('SPAM_TRIGGERED', 'Spam check triggered.');
  }

  const rawType = sanitizeSingleLine(input.feedbackType, 40) as SupportFeedbackType;
  if (!FEEDBACK_TYPE_LABELS[rawType]) {
    throw new SupportValidationError('INVALID_FEEDBACK_TYPE', 'Please choose a valid feedback type.');
  }

  const rawFeature = sanitizeSingleLine(input.relatedFeature, 80);
  const relatedFeature = SUPPORT_RELATED_FEATURES.includes(rawFeature as SupportRelatedFeature)
    ? rawFeature
    : rawFeature || 'General App';

  const message = sanitizeMultilineMessage(input.message, MAX_MESSAGE_LENGTH);
  if (message.length < MIN_MESSAGE_LENGTH) {
    throw new SupportValidationError(
      'MESSAGE_TOO_SHORT',
      `Please describe your feedback in at least ${MIN_MESSAGE_LENGTH} characters.`
    );
  }

  const effectiveEmailRaw = input.verifiedSessionEmail
    ? sanitizeSingleLine(input.verifiedSessionEmail, 160)
    : sanitizeSingleLine(input.replyEmail, 160);

  if (!isValidSupportEmail(effectiveEmailRaw)) {
    throw new SupportValidationError('INVALID_EMAIL', 'Please enter a valid reply email address.');
  }

  const language = sanitizeSingleLine(input.language || 'English', 40) || 'English';
  const screenshot = validateAndDecodeScreenshot(input.screenshotDataUrl);

  return {
    feedbackType: rawType,
    relatedFeature,
    message,
    replyEmail: effectiveEmailRaw,
    language,
    screenshot,
  };
}

export async function sendSupportFeedbackEmail(
  validated: ReturnType<typeof validateSupportFeedbackPayload>,
  options?: {
    isSignedIn: boolean;
    transporter?: Transporter;
    env?: NodeJS.ProcessEnv;
  }
): Promise<SupportDeliveryOutcome> {
  const env = options?.env || process.env;
  const { recipient } = resolveSupportRecipient(env);
  const submittedAt = new Date().toISOString();
  const typeLabel = FEEDBACK_TYPE_LABELS[validated.feedbackType];
  const userStatusLabel = options?.isSignedIn ? 'Signed-in User' : 'Guest User';

  const mailtoUrl = buildSupportMailtoUrl({
    feedbackType: validated.feedbackType,
    relatedFeature: validated.relatedFeature,
    replyEmail: validated.replyEmail,
    message: validated.message,
    submittedAtIso: submittedAt,
    userStatusLabel,
    hasScreenshot: Boolean(validated.screenshot),
  });

  const subject = `[Charaiva ${typeLabel}] ${validated.relatedFeature}`;
  const textBody = [
    'Charaiva Help & Support Submission',
    '-----------------------------------',
    `Feedback Type: ${typeLabel}`,
    `Related Feature: ${validated.relatedFeature}`,
    `User Reply Email: ${validated.replyEmail}`,
    `User Type: ${userStatusLabel}`,
    `App Language: ${validated.language}`,
    `Submitted At (UTC): ${submittedAt}`,
    `Screenshot Attached: ${validated.screenshot ? `Yes (${validated.screenshot.filename})` : 'No'}`,
    '',
    'Message:',
    validated.message,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; color: #1e293b;">
      <h2 style="margin-bottom: 4px; color: #0f172a;">Charaiva Help &amp; Feedback</h2>
      <p style="margin-top: 0; color: #64748b; font-size: 13px;">Submitted to ${escapeHtml(recipient)}</p>
      <table style="border-collapse: collapse; width: 100%; font-size: 14px; margin: 16px 0;">
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Feedback Type</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(typeLabel)}</td></tr>
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Related Feature</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(validated.relatedFeature)}</td></tr>
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Reply-To Email</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(validated.replyEmail)} (${escapeHtml(userStatusLabel)})</td></tr>
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Language</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(validated.language)}</td></tr>
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Submitted At (UTC)</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(submittedAt)}</td></tr>
        <tr><td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">Screenshot</td><td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0;">${validated.screenshot ? escapeHtml(validated.screenshot.filename) : 'None'}</td></tr>
      </table>
      <div style="padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; white-space: pre-wrap; font-size: 14px; line-height: 1.55;">
${escapeHtml(validated.message)}
      </div>
    </div>
  `.trim();

  // Option 1: Configured SMTP transporter (or injected test transporter)
  const smtpConfig = resolveSmtpConfig(env);
  const resendApiKey = cleanEnvValue(env.RESEND_API_KEY);
  const resendFrom = cleanEnvValue(env.RESEND_FROM);
  const hasResend = Boolean(resendApiKey && resendFrom);
  const diagnostics = resolveMailConfigDiagnostics(env);

  let smtpFailureOutcome: SupportDeliveryOutcome | null = null;

  if (options?.transporter || smtpConfig.configured) {
    console.info('[SupportMailer] Dispatching support feedback via SMTP', {
      host: smtpConfig.host || 'custom-transporter',
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      recipient,
      userType: userStatusLabel,
    });

    const transporter =
      options?.transporter ||
      nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        },
      });

    try {
      const info = await transporter.sendMail({
        from: formatSenderAddress(smtpConfig.from),
        to: recipient,
        replyTo: validated.replyEmail,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: validated.screenshot
          ? [
              {
                filename: validated.screenshot.filename,
                content: validated.screenshot.buffer,
                contentType: validated.screenshot.mimeType,
              },
            ]
          : undefined,
      });

      const accepted = Array.isArray(info?.accepted) ? info.accepted.map(String) : undefined;
      const rejected = Array.isArray(info?.rejected) ? info.rejected.map(String) : undefined;
      if ((rejected && rejected.length > 0) || (accepted && accepted.length === 0)) {
        console.info('[SupportMailer] SMTP server did not accept recipient', {
          recipient,
          rejected,
          response: info?.response,
        });
        smtpFailureOutcome = {
          delivered: false,
          deliveryStatus: 'delivery_failed',
          deliveryStage: 'not_accepted',
          provider: 'smtp',
          recipient,
          replyEmail: validated.replyEmail,
          submittedAt,
          mailtoUrl,
          errorCode: 'SMTP_RECIPIENT_REJECTED',
          error:
            'The email provider did not accept the recipient address. Your message is preserved — please retry or use the email app button below.',
        };
        if (!hasResend) {
          return smtpFailureOutcome;
        }
      } else {
        const providerResponse = info?.response ? sanitizeSingleLine(String(info.response), 120) : undefined;
        console.info('[SupportMailer] SMTP provider accepted feedback', {
          recipient,
          messageId: info?.messageId,
          accepted,
          response: providerResponse,
        });

        return {
          delivered: true,
          deliveryStatus: 'sent',
          deliveryStage: 'provider_accepted',
          provider: 'smtp',
          recipient,
          replyEmail: validated.replyEmail,
          submittedAt,
          mailtoUrl,
          messageId: info?.messageId ? String(info.messageId) : undefined,
          acceptedRecipients: accepted,
          providerResponse,
        };
      }
    } catch (err: any) {
      const authFailed = isSmtpAuthError(err);
      console.info('[SupportMailer] SMTP provider rejected delivery', {
        errorCode: authFailed ? 'SMTP_AUTH_FAILED' : 'SMTP_DELIVERY_FAILED',
        responseCode: err?.responseCode ?? null,
        code: err?.code ?? null,
        host: smtpConfig.host || 'custom-transporter',
        port: smtpConfig.port,
      });

      smtpFailureOutcome = {
        delivered: false,
        deliveryStatus: 'delivery_failed',
        deliveryStage: 'not_accepted',
        provider: 'smtp',
        recipient,
        replyEmail: validated.replyEmail,
        submittedAt,
        mailtoUrl,
        errorCode: authFailed ? 'SMTP_AUTH_FAILED' : 'SMTP_DELIVERY_FAILED',
        error: authFailed
          ? 'Email server authentication was rejected (535). If using Gmail SMTP, verify SMTP_USER is your full Gmail address and SMTP_PASS is a 16-character Google App Password (requires 2-Step Verification). Your feedback is preserved — retry after updating credentials or use the email app button below.'
          : 'The email server rejected or failed to deliver your message right now. Your text is preserved — you can retry or use your email app below.',
      };

      // Fall through to Resend if configured, otherwise return actionable SMTP failure outcome
      if (!hasResend) {
        return smtpFailureOutcome;
      }
    }
  }

  // Option 2: Optional Resend HTTP API if configured
  if (hasResend) {
    console.info('[SupportMailer] Dispatching support feedback via Resend HTTP API', {
      recipient,
      userType: userStatusLabel,
    });
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: formatSenderAddress(resendFrom),
          to: [recipient],
          reply_to: validated.replyEmail,
          subject,
          text: textBody,
          html: htmlBody,
          attachments: validated.screenshot
            ? [
                {
                  filename: validated.screenshot.filename,
                  content: validated.screenshot.buffer.toString('base64'),
                },
              ]
            : undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || `Email provider HTTP ${res.status}`);
      }
      console.info('[SupportMailer] Resend API accepted feedback', {
        recipient,
        messageId: data?.id,
      });
      return {
        delivered: true,
        deliveryStatus: 'sent',
        deliveryStage: 'provider_accepted',
        provider: 'resend',
        recipient,
        replyEmail: validated.replyEmail,
        submittedAt,
        mailtoUrl,
        messageId: data?.id ? String(data.id) : undefined,
        acceptedRecipients: [recipient],
      };
    } catch (err: any) {
      console.info('[SupportMailer] Resend provider rejected delivery', {
        errorCode: 'RESEND_DELIVERY_FAILED',
        detail: sanitizeSingleLine(err?.message || 'HTTP error', 120),
      });
      return (
        smtpFailureOutcome || {
          delivered: false,
          deliveryStatus: 'delivery_failed',
          deliveryStage: 'not_accepted',
          provider: 'resend',
          recipient,
          replyEmail: validated.replyEmail,
          submittedAt,
          mailtoUrl,
          errorCode: 'RESEND_DELIVERY_FAILED',
          error: 'Could not complete server email delivery right now. Your message is preserved — you can retry or open your email app below.',
        }
      );
    }
  }

  // Honest fallback when no server-side email credentials are configured
  console.info('[SupportMailer] No authorized email provider configured; returning honest not_configured fallback', {
    recipient,
    missingConfig: diagnostics.missingConfig,
  });
  return {
    delivered: false,
    deliveryStatus: 'not_configured',
    deliveryStage: 'not_accepted',
    recipient,
    replyEmail: validated.replyEmail,
    submittedAt,
    mailtoUrl,
    missingConfig: diagnostics.missingConfig,
    errorCode: 'MAIL_NOT_CONFIGURED',
    error: `Direct server email delivery is not configured on this server (missing: ${diagnostics.missingConfig.join(', ')}). Use the email app button below to send your feedback directly to ${recipient}.`,
  };
}
