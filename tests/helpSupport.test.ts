import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

import {
  OFFICIAL_SUPPORT_EMAIL,
  checkSupportRateLimit,
  checkSupportRateLimitBeforeSend,
  formatSenderAddress,
  recordSupportSubmissionOutcome,
  resetSupportRateLimitsForTests,
  resolveMailConfigDiagnostics,
  resolveSmtpConfig,
  resolveSupportRecipient,
  sendSupportFeedbackEmail,
  validateSupportFeedbackPayload,
} from '../server/supportMailer';

const TINY_PNG_BASE64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('validateSupportFeedbackPayload enforces guest email, message length, sanitization, and signed-in override', () => {
  assert.throws(
    () =>
      validateSupportFeedbackPayload({
        feedbackType: 'problem',
        relatedFeature: 'Discover Search',
        message: 'Too short',
        replyEmail: 'guest@example.com',
        isSignedInSession: false,
      }),
    /at least 10 characters/i
  );

  assert.throws(
    () =>
      validateSupportFeedbackPayload({
        feedbackType: 'problem',
        relatedFeature: 'Discover Search',
        message: 'Audio narration stops halfway through Discover explanations.',
        replyEmail: 'not-an-email',
        isSignedInSession: false,
      }),
    /valid reply email/i
  );

  assert.throws(
    () =>
      validateSupportFeedbackPayload({
        feedbackType: 'problem',
        relatedFeature: 'Discover Search',
        message: 'Legit message longer than ten characters.',
        replyEmail: 'guest@example.com',
        honeypot: 'http://spam.invalid',
        isSignedInSession: false,
      }),
    /Spam check/i
  );

  assert.throws(
    () =>
      validateSupportFeedbackPayload({
        feedbackType: 'suggestion',
        relatedFeature: 'General App',
        message: 'Trying invalid screenshot format check here.',
        replyEmail: 'guest@example.com',
        screenshotDataUrl: 'data:text/html;base64,PHNjcmlwdD4=',
        isSignedInSession: false,
      }),
    /PNG, JPEG, or WebP/i
  );

  // Signed-in session verified email MUST override any spoofed body replyEmail, and XSS/CRLF stripped
  const validated = validateSupportFeedbackPayload({
    feedbackType: 'incorrect_info',
    relatedFeature: 'Interactive Map',
    message: '<script>alert(1)</script> Marker coordinates for Hampi Vittala Temple are offset slightly.',
    replyEmail: 'spoofed-attacker@example.com\r\nBcc: evil@example.com',
    language: 'Hindi',
    screenshotDataUrl: TINY_PNG_BASE64,
    isSignedInSession: true,
    verifiedSessionEmail: 'verified.explorer@gmail.com',
  });

  assert.equal(validated.replyEmail, 'verified.explorer@gmail.com');
  assert.equal(validated.feedbackType, 'incorrect_info');
  assert.equal(validated.relatedFeature, 'Interactive Map');
  assert.ok(!validated.message.includes('<script>'));
  assert.ok(validated.screenshot !== null);
  assert.equal(validated.screenshot?.mimeType, 'image/png');
});

test('sendSupportFeedbackEmail sends to charaiva10@gmail.com with user as Reply-To via configured SMTP transporter', async () => {
  const validated = validateSupportFeedbackPayload({
    feedbackType: 'problem',
    relatedFeature: 'Photo Guide & OCR',
    message: 'Candidate cards did not load smoothly on my phone after switching back.',
    replyEmail: 'traveler.guest@gmail.com',
    language: 'English',
    screenshotDataUrl: TINY_PNG_BASE64,
    isSignedInSession: false,
  });

  const jsonTransport = nodemailer.createTransport({ jsonTransport: true });
  const outcome = await sendSupportFeedbackEmail(validated, {
    isSignedIn: false,
    transporter: jsonTransport,
    env: {
      ...process.env,
      SUPPORT_RECIPIENT_EMAIL: OFFICIAL_SUPPORT_EMAIL,
      SMTP_FROM: 'noreply@charaiva.app',
    },
  });

  assert.equal(outcome.delivered, true);
  assert.equal(outcome.deliveryStatus, 'sent');
  assert.equal(outcome.recipient, 'charaiva10@gmail.com');
  assert.equal(outcome.replyEmail, 'traveler.guest@gmail.com');

  // Inspect actual envelope produced by nodemailer
  let capturedEnvelope: any = null;
  const captureTransport = {
    sendMail: async (mailOptions: any) => {
      capturedEnvelope = mailOptions;
      return { messageId: 'mock-id-123' };
    },
  } as any;

  const outcome2 = await sendSupportFeedbackEmail(validated, {
    isSignedIn: true,
    transporter: captureTransport,
    env: {
      ...process.env,
      SMTP_FROM: 'support-mailer@charaiva.app',
    },
  });

  assert.equal(outcome2.delivered, true);
  assert.equal(capturedEnvelope.to, 'charaiva10@gmail.com');
  assert.equal(capturedEnvelope.replyTo, 'traveler.guest@gmail.com');
  assert.match(capturedEnvelope.from, /support-mailer@charaiva\.app/);
  assert.doesNotMatch(capturedEnvelope.from, /traveler\.guest@gmail\.com/);
  assert.match(capturedEnvelope.text, /Report a Problem/);
  assert.match(capturedEnvelope.text, /Photo Guide & OCR/);
  assert.match(capturedEnvelope.text, /traveler\.guest@gmail\.com/);
  assert.match(capturedEnvelope.text, /Submitted At \(UTC\):/);
  assert.equal(capturedEnvelope.attachments.length, 1);
  assert.equal(capturedEnvelope.attachments[0].filename, 'charaiva-feedback-screenshot.png');
});

test('sendSupportFeedbackEmail returns honest not_configured and delivery_failed errors with mailto fallback', async () => {
  const validated = validateSupportFeedbackPayload({
    feedbackType: 'suggestion',
    relatedFeature: 'Discover Search',
    message: 'Please add offline saved notes inside Discover search results.',
    replyEmail: 'guest.user@example.org',
    isSignedInSession: false,
  });

  const unconfigured = await sendSupportFeedbackEmail(validated, {
    isSignedIn: false,
    env: {},
  });
  assert.equal(unconfigured.delivered, false);
  assert.equal(unconfigured.deliveryStatus, 'not_configured');
  assert.equal(unconfigured.recipient, 'charaiva10@gmail.com');
  assert.ok(unconfigured.mailtoUrl.startsWith('mailto:charaiva10@gmail.com?'));
  assert.match(unconfigured.mailtoUrl, /Discover%20Search/);

  const failingTransport = {
    sendMail: async () => {
      const err: any = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
      err.code = 'EAUTH';
      err.responseCode = 535;
      throw err;
    },
  } as any;

  const failed = await sendSupportFeedbackEmail(validated, {
    isSignedIn: false,
    transporter: failingTransport,
    env: { SMTP_FROM: 'support@charaiva.app' },
  });
  assert.equal(failed.delivered, false);
  assert.equal(failed.deliveryStatus, 'delivery_failed');
  assert.equal(failed.errorCode, 'SMTP_AUTH_FAILED');
  assert.match(failed.error || '', /535|App Password/i);
  assert.ok(failed.mailtoUrl.startsWith('mailto:charaiva10@gmail.com?'));
});

test('resolveSmtpConfig normalizes quoted secrets, Gmail App Password spaces, and TLS port flags', () => {
  const gmail587 = resolveSmtpConfig({
    SMTP_HOST: ' "smtp.gmail.com" ',
    SMTP_PORT: "'587'",
    SMTP_SECURE: 'true', // should align to false for STARTTLS port 587
    SMTP_USER: ' "charaiva10@gmail.com" ',
    SMTP_PASS: ' "abcd efgh ijkl mnop" ',
  });
  assert.equal(gmail587.configured, true);
  assert.equal(gmail587.host, 'smtp.gmail.com');
  assert.equal(gmail587.port, 587);
  assert.equal(gmail587.secure, false);
  assert.equal(gmail587.user, 'charaiva10@gmail.com');
  assert.equal(gmail587.pass, 'abcdefghijklmnop');
  assert.equal(gmail587.from, 'charaiva10@gmail.com');

  const gmail465 = resolveSmtpConfig({
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'false', // should align to true for implicit TLS port 465
    SMTP_USER: 'charaiva10@gmail.com',
    SMTP_PASS: 'abcdefghijklmnop',
    SMTP_FROM: 'noreply@charaiva.app',
  });
  assert.equal(gmail465.configured, true);
  assert.equal(gmail465.port, 465);
  assert.equal(gmail465.secure, true);
  assert.equal(gmail465.from, 'noreply@charaiva.app');
});

test('sendSupportFeedbackEmail falls back to Resend HTTP API when SMTP rejects auth with 535', async () => {
  const validated = validateSupportFeedbackPayload({
    feedbackType: 'problem',
    relatedFeature: 'Discover Search',
    message: 'Testing fallback to Resend when SMTP auth fails.',
    replyEmail: 'guest@example.org',
    isSignedInSession: false,
  });

  const failingTransport = {
    sendMail: async () => {
      const err: any = new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
      err.code = 'EAUTH';
      err.responseCode = 535;
      throw err;
    },
  } as any;

  const originalFetch = globalThis.fetch;
  let resendCalled = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      resendCalled = true;
      const body = JSON.parse(String(init?.body || '{}'));
      assert.deepEqual(body.to, ['charaiva10@gmail.com']);
      assert.equal(body.reply_to, 'guest@example.org');
      return new Response(JSON.stringify({ id: 'resend-msg-42' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const outcome = await sendSupportFeedbackEmail(validated, {
      isSignedIn: false,
      transporter: failingTransport,
      env: {
        SMTP_FROM: 'support@charaiva.app',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM: 'support@charaiva.app',
      },
    });
    assert.equal(resendCalled, true);
    assert.equal(outcome.delivered, true);
    assert.equal(outcome.deliveryStatus, 'sent');
    assert.equal(outcome.messageId, 'resend-msg-42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkSupportRateLimit blocks duplicate rapid resubmits and excessive bursts per IP', () => {
  resetSupportRateLimitsForTests();

  const first = checkSupportRateLimit('127.0.0.10', 'a@example.com', 'First valid feedback message.');
  assert.equal(first.allowed, true);

  // Duplicate same user+message within 30s
  const dup = checkSupportRateLimit('127.0.0.10', 'a@example.com', 'First valid feedback message.');
  assert.equal(dup.allowed, false);
  assert.equal(dup.errorCode, 'DUPLICATE_ALREADY_ACCEPTED');
  assert.match(dup.reason || '', /30 seconds/i);

  // Different messages up to limit (5 total for IP)
  for (let i = 2; i <= 5; i++) {
    const r = checkSupportRateLimit('127.0.0.10', 'a@example.com', `Distinct message number ${i}`);
    assert.equal(r.allowed, true);
  }
  const sixth = checkSupportRateLimit('127.0.0.10', 'a@example.com', 'Distinct message number 6');
  assert.equal(sixth.allowed, false);
  assert.equal(sixth.errorCode, 'RATE_LIMITED');
  assert.match(sixth.reason || '', /Too many/i);

  resetSupportRateLimitsForTests();
});

test('failed submissions are NOT blocked from retrying identical messages, while accepted submissions trigger 30s cooldown', () => {
  resetSupportRateLimitsForTests();

  const ip = '10.0.0.55';
  const email = 'retry.user@example.com';
  const msg = 'My audio narration stopped working on Discover.';

  // 1. First attempt fails delivery
  const attempt1 = checkSupportRateLimitBeforeSend(ip, email, msg);
  assert.equal(attempt1.allowed, true);
  recordSupportSubmissionOutcome(ip, email, msg, false);

  // 2. Immediate retry of IDENTICAL message MUST be allowed (no false duplicate block!)
  const attempt2 = checkSupportRateLimitBeforeSend(ip, email, msg);
  assert.equal(attempt2.allowed, true);
  recordSupportSubmissionOutcome(ip, email, msg, false);

  // 3. Third attempt succeeds -> accepted by mail provider
  const attempt3 = checkSupportRateLimitBeforeSend(ip, email, msg);
  assert.equal(attempt3.allowed, true);
  recordSupportSubmissionOutcome(ip, email, msg, true);

  // 4. Subsequent identical submit within 30s IS blocked cleanly
  const attempt4 = checkSupportRateLimitBeforeSend(ip, email, msg);
  assert.equal(attempt4.allowed, false);
  assert.equal(attempt4.errorCode, 'DUPLICATE_ALREADY_ACCEPTED');

  resetSupportRateLimitsForTests();
});

test('resolveSupportRecipient always enforces charaiva10@gmail.com and resolveMailConfigDiagnostics lists missing secrets safely', async () => {
  const unset = resolveSupportRecipient({});
  assert.equal(unset.recipient, 'charaiva10@gmail.com');
  assert.equal(unset.envConfiguredCorrectly, false);

  const misconfigured = resolveSupportRecipient({ SUPPORT_RECIPIENT_EMAIL: 'someone.else@example.com' });
  assert.equal(misconfigured.recipient, 'charaiva10@gmail.com');
  assert.equal(misconfigured.envConfiguredCorrectly, false);

  const valid = resolveSupportRecipient({ SUPPORT_RECIPIENT_EMAIL: 'charaiva10@gmail.com' });
  assert.equal(valid.recipient, 'charaiva10@gmail.com');
  assert.equal(valid.envConfiguredCorrectly, true);

  const diag = resolveMailConfigDiagnostics({ SMTP_HOST: 'smtp.gmail.com' });
  assert.equal(diag.smtpConfigured, false);
  assert.deepEqual(diag.missingConfig, ['SMTP_USER', 'SMTP_PASS']);

  assert.equal(formatSenderAddress('support@charaiva.app'), 'Charaiva Help & Support <support@charaiva.app>');
  assert.equal(formatSenderAddress('Custom <custom@charaiva.app>'), 'Custom <custom@charaiva.app>');

  // Verify SMTP recipient rejection does not claim accepted
  const validated = validateSupportFeedbackPayload({
    feedbackType: 'problem',
    relatedFeature: 'Discover Search',
    message: 'Testing SMTP recipient rejection detection cleanly.',
    replyEmail: 'user@example.com',
    isSignedInSession: false,
  });

  const rejectingTransport = {
    sendMail: async () => ({
      messageId: 'rej-1',
      accepted: [],
      rejected: ['charaiva10@gmail.com'],
      response: '550 5.1.1 User unknown',
    }),
  } as any;

  const rejOutcome = await sendSupportFeedbackEmail(validated, {
    isSignedIn: false,
    transporter: rejectingTransport,
    env: { SMTP_FROM: 'noreply@charaiva.app' },
  });
  assert.equal(rejOutcome.delivered, false);
  assert.equal(rejOutcome.deliveryStage, 'not_accepted');
  assert.equal(rejOutcome.errorCode, 'SMTP_RECIPIENT_REJECTED');
});
