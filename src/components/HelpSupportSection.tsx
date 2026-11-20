import React, { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  HelpCircle,
  ImagePlus,
  LifeBuoy,
  Lightbulb,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { auth } from '../firebase';
import { useLocalizedTexts } from '../data/localizedStrings';
import { Language, UserProfile } from '../types';

export type SupportFeedbackType = 'problem' | 'suggestion' | 'incorrect_info';

export const OFFICIAL_SUPPORT_EMAIL = 'charaiva10@gmail.com';
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const SUPPORT_FEATURE_OPTIONS = [
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

interface HelpSupportSectionProps {
  selectedLanguage: Language;
  userProfile?: UserProfile | null;
  onBack: () => void;
}

const HELP_UI_DEFAULTS = {
  backToSettings: 'Back to Settings',
  heading: 'Help & Feedback',
  subtitle: 'Help us make Charaiva better.',
  supportAddressLabel: 'Official Support',
  feedbackTypeLabel: 'Feedback Type',
  typeProblem: 'Report a Problem',
  typeProblemHint: 'Bugs, crashes, audio or loading issues',
  typeSuggestion: 'Share Feedback or Suggestion',
  typeSuggestionHint: 'Ideas to improve Charaiva',
  typeIncorrect: 'Report Incorrect Information',
  typeIncorrectHint: 'Historical, factual, or location corrections',
  featureLabel: 'Related Feature',
  messageLabel: 'Your Message',
  messagePlaceholder: 'Please share clear details about what happened or what we can improve...',
  charactersLabel: 'characters',
  verifiedEmailLabel: 'Verified Reply Email',
  verifiedEmailNote: 'Read from your signed-in session and used as the reply address. Credentials and tokens are never exposed.',
  guestEmailLabel: 'Your Email Address',
  guestEmailPlaceholder: 'you@example.com',
  guestEmailNote: 'Used only to reply to your feedback — no account required.',
  screenshotLabel: 'Optional Screenshot',
  screenshotChoose: 'Attach Screenshot (PNG, JPEG, WebP · max 2 MB)',
  screenshotRemove: 'Remove Screenshot',
  screenshotPrivacyNote:
    'Optional — attached only if you select an image here. Conversations, GPS history, and account data are never attached automatically.',
  submitButton: 'Send Feedback',
  sendingButton: 'Sending...',
  successTitle: 'Feedback Accepted by Mail Server',
  successBody:
    'Your message was accepted by the email provider for delivery to charaiva10@gmail.com. Note: server acceptance confirms handoff to the mail carrier, not guaranteed final inbox delivery. Replies will be sent to:',
  providerAcceptedLabel: 'Accepted via',
  messageIdLabel: 'Reference ID',
  sendAnother: 'Send Another Message',
  fallbackCta: 'Open Email App to Send to charaiva10@gmail.com',
  fallbackHint: 'All text you entered above is preserved. You can retry server delivery or send using your email app below.',
  missingConfigLabel: 'Missing server configuration',
  retryButton: 'Try Sending Again',
  errEmailRequired: 'Please enter a valid email address so we can reply to your feedback.',
  errMessageTooShort: 'Please write at least 10 characters so our support team can understand and help.',
  errScreenshotType: 'Please select a PNG, JPEG, or WebP screenshot image.',
  errScreenshotSize: 'Screenshot image must be smaller than 2 MB.',
  errScreenshotInvalid: 'Please attach a valid PNG, JPEG, or WebP image under 2 MB.',
  errInvalidType: 'Please choose a valid feedback type.',
  errAuthSession: 'Could not verify your signed-in session. Please sign in again or continue as a guest.',
  errDuplicateAccepted:
    'An identical message was already accepted by the mail server within the last 30 seconds. Please wait 30 seconds before sending the same message again.',
  errRateLimited: 'Too many submissions in a short period. Please wait a few minutes before trying again.',
  errSmtpAuthFailed:
    'Email server authentication failed (535). Verify SMTP_USER and use a 16-character Google App Password in SMTP_PASS. Your feedback is preserved — retry or send via your email app below.',
  errDeliveryFailed:
    'The email provider did not accept or deliver your message right now. Your feedback is preserved — please try sending again or use your email app below.',
  errNotConfigured:
    'Direct server email delivery is not configured yet on this server. Your feedback is preserved — use the email app button below to send directly to charaiva10@gmail.com.',
  errNetwork: 'Could not reach the support server right now. Your feedback is preserved — please try sending again or send via your email app below.',
  featGeneralApp: 'General App',
  featExploreHome: 'Explore Home & City Guide',
  featPhotoGuide: 'Photo Guide & OCR',
  featDiscoverSearch: 'Discover Search',
  featNearbyAttractions: 'Nearby Attractions',
  featAiGuideChat: 'AI Guide Chat',
  featInteractiveMap: 'Interactive Map',
  featTourJournal: 'Tour Journal',
  featSettingsVoiceLanguage: 'Settings, Voice & Language',
};

const HINDI_HELP_UI: typeof HELP_UI_DEFAULTS = {
  backToSettings: 'सेटिंग्स पर वापस जाएं',
  heading: 'सहायता और फ़ीडबैक',
  subtitle: 'चरैवा को और बेहतर बनाने में हमारी मदद करें।',
  supportAddressLabel: 'आधिकारिक सहायता ईमेल',
  feedbackTypeLabel: 'फ़ीडबैक का प्रकार',
  typeProblem: 'समस्या की रिपोर्ट करें',
  typeProblemHint: 'बग, क्रैश, ऑडियो या लोडिंग की समस्याएं',
  typeSuggestion: 'फ़ीडबैक या सुझाव साझा करें',
  typeSuggestionHint: 'चरैवा को बेहतर बनाने के विचार',
  typeIncorrect: 'गलत जानकारी की रिपोर्ट करें',
  typeIncorrectHint: 'ऐतिहासिक, तथ्यात्मक या स्थान संबंधी सुधार',
  featureLabel: 'संबंधित फ़ीचर',
  messageLabel: 'आपका संदेश',
  messagePlaceholder: 'कृपया विस्तार से बताएं कि क्या हुआ या हम क्या बेहतर बना सकते हैं...',
  charactersLabel: 'अक्षर',
  verifiedEmailLabel: 'सत्यापित उत्तर ईमेल',
  verifiedEmailNote: 'यह आपके साइन-इन सत्र से लिया गया है और उत्तर भेजने के लिए उपयोग होगा। क्रेडेंशियल या टोकन कभी साझा नहीं किए जाते।',
  guestEmailLabel: 'आपका ईमेल पता',
  guestEmailPlaceholder: 'you@example.com',
  guestEmailNote: 'इसका उपयोग केवल आपके फ़ीडबैक का उत्तर देने के लिए किया जाएगा — खाता बनाने की आवश्यकता नहीं है।',
  screenshotLabel: 'वैकल्पिक स्क्रीनशॉट',
  screenshotChoose: 'स्क्रीनशॉट संलग्न करें (PNG, JPEG, WebP · अधिकतम 2 MB)',
  screenshotRemove: 'स्क्रीनशॉट हटाएं',
  screenshotPrivacyNote:
    'वैकल्पिक — केवल वही छवि संलग्न होगी जिसे आप चुनेंगे। बातचीत, GPS इतिहास या खाता डेटा अपने आप कभी संलग्न नहीं होता।',
  submitButton: 'फ़ीडबैक भेजें',
  sendingButton: 'भेजा जा रहा है...',
  successTitle: 'मेल सर्वर द्वारा फ़ीडबैक स्वीकार किया गया',
  successBody:
    'आपका संदेश charaiva10@gmail.com पर भेजने के लिए ईमेल प्रदाता द्वारा स्वीकार कर लिया गया है। नोट: सर्वर स्वीकृति केवल मेल प्रदाता तक हैंडऑफ़ की पुष्टि करती है, अंतिम इनबॉक्स डिलीवरी की नहीं। उत्तर इस ईमेल पर भेजे जाएंगे:',
  providerAcceptedLabel: 'प्रदाता माध्यम',
  messageIdLabel: 'संदर्भ आईडी',
  sendAnother: 'एक और संदेश भेजें',
  fallbackCta: 'ईमेल ऐप खोलकर charaiva10@gmail.com पर भेजें',
  fallbackHint: 'ऊपर लिखा आपका पूरा संदेश सुरक्षित है। आप पुनः भेजने का प्रयास कर सकते हैं या नीचे ईमेल ऐप से सीधे भेज सकते हैं।',
  missingConfigLabel: 'लापता सर्वर कॉन्फ़िगरेशन',
  retryButton: 'पुनः भेजने का प्रयास करें',
  errEmailRequired: 'कृपया एक मान्य ईमेल पता दर्ज करें ताकि हम आपके फ़ीडबैक का उत्तर दे सकें।',
  errMessageTooShort: 'कृपया कम से कम 10 अक्षर लिखें ताकि हमारी सहायता टीम आपकी बात समझ सके।',
  errScreenshotType: 'कृपया केवल PNG, JPEG या WebP स्क्रीनशॉट छवि चुनें।',
  errScreenshotSize: 'स्क्रीनशॉट छवि का आकार 2 MB से कम होना चाहिए।',
  errScreenshotInvalid: 'कृपया 2 MB से कम आकार की मान्य PNG, JPEG या WebP छवि संलग्न करें।',
  errInvalidType: 'कृपया फ़ीडबैक का मान्य प्रकार चुनें।',
  errAuthSession: 'आपके साइन-इन सत्र की पुष्टि नहीं हो सकी। कृपया पुनः साइन इन करें या अतिथि के रूप में जारी रखें।',
  errDuplicateAccepted:
    'पिछले 30 सेकंड के भीतर मेल सर्वर द्वारा यही संदेश पहले ही स्वीकार किया जा चुका है। कृपया वही संदेश दोबारा भेजने से पहले 30 सेकंड प्रतीक्षा करें।',
  errRateLimited: 'कम समय में बहुत अधिक संदेश भेजे गए हैं। कृपया कुछ मिनट प्रतीक्षा करके पुनः प्रयास करें।',
  errSmtpAuthFailed:
    'ईमेल सर्वर प्रमाणीकरण अस्वीकृत (535) हो गया। Gmail SMTP के लिए SMTP_USER और 16-अक्षरों का Google App Password जांचें। आपका संदेश सुरक्षित है — पुनः प्रयास करें या नीचे ईमेल ऐप से भेजें।',
  errDeliveryFailed:
    'ईमेल प्रदाता अभी आपका संदेश स्वीकार या डिलीवर नहीं कर सका। आपका दर्ज किया गया फ़ीडबैक सुरक्षित है — कृपया पुनः भेजने का प्रयास करें या नीचे ईमेल ऐप का उपयोग करें।',
  errNotConfigured:
    'इस सर्वर पर डायरेक्ट ईमेल डिलीवरी अभी कॉन्फ़िगर नहीं है। आपका फ़ीडबैक सुरक्षित है — charaiva10@gmail.com पर सीधे भेजने के लिए नीचे ईमेल ऐप बटन का उपयोग करें।',
  errNetwork: 'अभी सहायता सर्वर से संपर्क नहीं हो सका। आपका फ़ीडबैक सुरक्षित है — कृपया पुनः प्रयास करें या नीचे ईमेल ऐप से भेजें।',
  featGeneralApp: 'सामान्य ऐप',
  featExploreHome: 'एक्सप्लोर होम और सिटी गाइड',
  featPhotoGuide: 'फोटो गाइड और OCR',
  featDiscoverSearch: 'डिस्कवर खोज',
  featNearbyAttractions: 'आसपास के आकर्षण',
  featAiGuideChat: 'AI गाइड चैट',
  featInteractiveMap: 'इंटरैक्टिव मानचित्र',
  featTourJournal: 'यात्रा डायरी',
  featSettingsVoiceLanguage: 'सेटिंग्स, आवाज़ और भाषा',
};

function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 160 || /[\r\n]/.test(trimmed)) return false;
  return /^[^\s@<>()[\]\\,;:\s"]+@[^\s@<>()[\]\\,;:\s"]{2,}$/.test(trimmed);
}

function buildFallbackMailto(params: {
  feedbackType: SupportFeedbackType;
  relatedFeature: string;
  replyEmail: string;
  message: string;
  hasScreenshot: boolean;
}): string {
  const typeLabelMap: Record<SupportFeedbackType, string> = {
    problem: 'Report a Problem',
    suggestion: 'Share Feedback or Suggestion',
    incorrect_info: 'Report Incorrect Information',
  };
  const typeLabel = typeLabelMap[params.feedbackType];
  const subject = `[Charaiva ${typeLabel}] ${params.relatedFeature}`;
  const body = [
    `Feedback Type: ${typeLabel}`,
    `Related Feature: ${params.relatedFeature}`,
    `Reply-To Email: ${params.replyEmail || 'Not provided'}`,
    ...(params.hasScreenshot
      ? ['Note: Please attach your screenshot in your email app before sending.']
      : []),
    '',
    'Message:',
    params.message,
  ].join('\n');
  return `mailto:${OFFICIAL_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    body.slice(0, 1500)
  )}`;
}

export const HelpSupportSection: React.FC<HelpSupportSectionProps> = ({
  selectedLanguage,
  userProfile,
  onBack,
}) => {
  const { t: localizedT } = useLocalizedTexts(
    HELP_UI_DEFAULTS,
    selectedLanguage,
    'Help and Support feedback form inside Settings'
  );
  const t = selectedLanguage.code === 'hi' ? HINDI_HELP_UI : localizedT;

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(() => auth.currentUser);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
    });
    return () => unsubscribe();
  }, []);

  const sessionVerifiedEmail =
    firebaseUser?.email && isValidEmailFormat(firebaseUser.email) ? firebaseUser.email.trim() : null;

  const initialPrefillEmail =
    userProfile?.authMethod === 'local' &&
    userProfile?.email &&
    userProfile.email !== 'guest@charaiva.app' &&
    isValidEmailFormat(userProfile.email)
      ? userProfile.email
      : '';

  const [feedbackType, setFeedbackType] = useState<SupportFeedbackType>('problem');
  const [relatedFeature, setRelatedFeature] = useState<string>(SUPPORT_FEATURE_OPTIONS[0]);
  const [message, setMessage] = useState('');
  const [guestEmail, setGuestEmail] = useState(initialPrefillEmail);
  const [honeypot, setHoneypot] = useState('');
  const hasPrefilledEmailRef = useRef(Boolean(initialPrefillEmail));

  useEffect(() => {
    if (
      !hasPrefilledEmailRef.current &&
      userProfile?.authMethod === 'local' &&
      userProfile?.email &&
      userProfile.email !== 'guest@charaiva.app' &&
      isValidEmailFormat(userProfile.email)
    ) {
      hasPrefilledEmailRef.current = true;
      setGuestEmail(userProfile.email);
    }
  }, [userProfile?.authMethod, userProfile?.email]);

  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deliveryIssue, setDeliveryIssue] = useState<{
    message: string;
    mailtoUrl: string;
    isNotConfigured: boolean;
    missingConfig?: string[];
  } | null>(null);
  const [sentResult, setSentResult] = useState<{
    recipient: string;
    replyEmail: string;
    submittedAt: string;
    provider?: string;
    messageId?: string;
  } | null>(null);

  const isRtl = selectedLanguage.direction === 'rtl';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setFormError(t.errScreenshotType);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setFormError(t.errScreenshotSize);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setScreenshotDataUrl(reader.result);
        setScreenshotName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveScreenshot = () => {
    setScreenshotDataUrl(null);
    setScreenshotName(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resolveLocalizedServerError = (errorCode?: string, deliveryStatus?: string): string => {
    switch (errorCode) {
      case 'DUPLICATE_ALREADY_ACCEPTED':
        return t.errDuplicateAccepted;
      case 'RATE_LIMITED':
        return t.errRateLimited;
      case 'SMTP_AUTH_FAILED':
        return t.errSmtpAuthFailed;
      case 'MAIL_NOT_CONFIGURED':
        return t.errNotConfigured;
      case 'INVALID_EMAIL':
        return t.errEmailRequired;
      case 'MESSAGE_TOO_SHORT':
        return t.errMessageTooShort;
      case 'INVALID_SCREENSHOT':
        return t.errScreenshotInvalid;
      case 'INVALID_FEEDBACK_TYPE':
        return t.errInvalidType;
      case 'AUTH_ERROR':
        return t.errAuthSession;
      case 'SMTP_RECIPIENT_REJECTED':
      case 'SMTP_DELIVERY_FAILED':
      case 'RESEND_DELIVERY_FAILED':
        return t.errDeliveryFailed;
      default:
        if (deliveryStatus === 'not_configured') return t.errNotConfigured;
        if (deliveryStatus === 'delivery_failed') return t.errDeliveryFailed;
        return t.errNetwork;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setDeliveryIssue(null);

    const trimmedMessage = message.trim();
    const effectiveReplyEmail = (sessionVerifiedEmail || guestEmail).trim();

    if (!sessionVerifiedEmail && !isValidEmailFormat(effectiveReplyEmail)) {
      setFormError(t.errEmailRequired);
      return;
    }
    if (trimmedMessage.length < 10) {
      setFormError(t.errMessageTooShort);
      return;
    }

    setIsSubmitting(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (firebaseUser && sessionVerifiedEmail) {
        try {
          const idToken = await firebaseUser.getIdToken();
          if (idToken) {
            headers.Authorization = `Bearer ${idToken}`;
          }
        } catch {
          try {
            const refreshed = await firebaseUser.getIdToken(true);
            if (refreshed) {
              headers.Authorization = `Bearer ${refreshed}`;
            }
          } catch {
            // Allow backend to handle unauthenticated/expired state cleanly
          }
        }
      }

      const res = await fetch('/api/support/feedback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          feedbackType,
          relatedFeature,
          message: trimmedMessage,
          replyEmail: effectiveReplyEmail,
          language: selectedLanguage.name,
          screenshotDataUrl: screenshotDataUrl || undefined,
          honeypot,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.success && data?.deliveryStatus === 'sent') {
        setSentResult({
          recipient: data.recipient || OFFICIAL_SUPPORT_EMAIL,
          replyEmail: data.replyEmail || effectiveReplyEmail,
          submittedAt: data.submittedAt || new Date().toISOString(),
          provider: data.provider,
          messageId: data.messageId,
        });
        setMessage('');
        handleRemoveScreenshot();
        return;
      }

      const fallbackUrl =
        typeof data?.mailtoUrl === 'string' && data.mailtoUrl.startsWith('mailto:')
          ? data.mailtoUrl
          : buildFallbackMailto({
              feedbackType,
              relatedFeature,
              replyEmail: effectiveReplyEmail,
              message: trimmedMessage,
              hasScreenshot: Boolean(screenshotDataUrl),
            });

      const localizedMsg = resolveLocalizedServerError(data?.errorCode, data?.deliveryStatus);

      if (data?.deliveryStatus === 'not_configured' || data?.deliveryStatus === 'delivery_failed') {
        setDeliveryIssue({
          message: localizedMsg,
          mailtoUrl: fallbackUrl,
          isNotConfigured: data?.deliveryStatus === 'not_configured',
          missingConfig: Array.isArray(data?.missingConfig) ? data.missingConfig : undefined,
        });
        return;
      }

      setFormError(localizedMsg);
    } catch {
      const effectiveReplyEmail = (sessionVerifiedEmail || guestEmail).trim();
      setDeliveryIssue({
        message: t.errNetwork,
        mailtoUrl: buildFallbackMailto({
          feedbackType,
          relatedFeature,
          replyEmail: effectiveReplyEmail,
          message: message.trim(),
          hasScreenshot: Boolean(screenshotDataUrl),
        }),
        isNotConfigured: false,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const feedbackTypeOptions: Array<{
    id: SupportFeedbackType;
    label: string;
    hint: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'problem',
      label: t.typeProblem,
      hint: t.typeProblemHint,
      icon: <Bug className="w-4 h-4 text-rose-400 shrink-0" />,
    },
    {
      id: 'suggestion',
      label: t.typeSuggestion,
      hint: t.typeSuggestionHint,
      icon: <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" />,
    },
    {
      id: 'incorrect_info',
      label: t.typeIncorrect,
      hint: t.typeIncorrectHint,
      icon: <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0" />,
    },
  ];

  return (
    <div
      id="help-support-section"
      dir={isRtl ? 'rtl' : 'ltr'}
      className="space-y-3 select-text pb-4"
    >
      {/* Top Bar + Header Card */}
      <div
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="p-4 rounded-2xl border shadow-lg space-y-3 backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            id="btn-help-back-to-settings"
            type="button"
            onClick={onBack}
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-text-title)',
            }}
            className="min-h-[38px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all"
          >
            <ArrowLeft className={`w-3.5 h-3.5 text-[var(--theme-accent-primary)] ${isRtl ? 'rotate-180' : ''}`} />
            <span>{t.backToSettings}</span>
          </button>

          <span
            style={{
              backgroundColor: 'var(--theme-card-bg-subtle)',
              borderColor: 'var(--theme-card-border)',
              color: 'var(--theme-accent-secondary)',
            }}
            className="px-2.5 py-1 rounded-full border text-[11px] font-semibold flex items-center gap-1.5"
          >
            <Mail className="w-3 h-3 text-[var(--theme-accent-primary)]" />
            <span>{OFFICIAL_SUPPORT_EMAIL}</span>
          </span>
        </div>

        <div className="flex items-start gap-3 pt-1">
          <div
            style={{
              background: 'var(--theme-accent-primary-gradient)',
              color: 'var(--theme-accent-primary-text)',
            }}
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-md"
          >
            <LifeBuoy className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-serif font-bold text-[var(--theme-text-title)] leading-tight">
              {t.heading}
            </h2>
            <p className="text-xs text-[var(--theme-text-muted)] mt-0.5">{t.subtitle}</p>
          </div>
        </div>
      </div>

      {/* Confirmation Banner when delivered */}
      {sentResult ? (
        <div
          id="help-support-success-card"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'rgba(16, 185, 129, 0.45)',
          }}
          className="p-5 rounded-2xl border shadow-lg space-y-3 backdrop-blur-md"
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h3 className="text-sm font-bold text-emerald-300">{t.successTitle}</h3>
              <p className="text-xs text-[var(--theme-text-body)] leading-relaxed">
                {t.successBody}{' '}
                <span className="font-bold text-[var(--theme-text-title)]">{sentResult.replyEmail}</span>
              </p>
              <p className="text-[11px] text-[var(--theme-text-muted)]">
                {t.supportAddressLabel}: {sentResult.recipient}
              </p>
              {(sentResult.provider || sentResult.messageId) && (
                <p className="text-[11px] text-[var(--theme-text-muted)]">
                  {sentResult.provider ? `${t.providerAcceptedLabel}: ${sentResult.provider.toUpperCase()}` : ''}
                  {sentResult.provider && sentResult.messageId ? ' · ' : ''}
                  {sentResult.messageId ? `${t.messageIdLabel}: ${sentResult.messageId}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              id="btn-help-send-another"
              type="button"
              onClick={() => {
                setSentResult(null);
                setFormError(null);
                setDeliveryIssue(null);
              }}
              className="min-h-[42px] px-4 rounded-xl theme-btn-primary text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{t.sendAnother}</span>
            </button>
            <button
              type="button"
              onClick={onBack}
              className="min-h-[42px] px-4 rounded-xl theme-btn-secondary text-xs font-semibold cursor-pointer"
            >
              {t.backToSettings}
            </button>
          </div>
        </div>
      ) : (
        <form
          id="help-support-form"
          onSubmit={handleSubmit}
          noValidate
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-card-border)',
          }}
          className="p-4 rounded-2xl border shadow-lg space-y-4 backdrop-blur-md"
        >
          {/* Hidden Honeypot for Bot Filtering */}
          <div className="sr-only" aria-hidden="true">
            <label htmlFor="support-company-field">Leave blank</label>
            <input
              id="support-company-field"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {/* 1. Feedback Type Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-[var(--theme-accent-primary)] uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>{t.feedbackTypeLabel}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {feedbackTypeOptions.map((opt) => {
                const isSelected = feedbackType === opt.id;
                return (
                  <button
                    key={opt.id}
                    id={`btn-feedback-type-${opt.id}`}
                    type="button"
                    onClick={() => setFeedbackType(opt.id)}
                    style={{
                      backgroundColor: isSelected ? 'var(--theme-card-bg-subtle)' : 'var(--theme-card-bg)',
                      borderColor: isSelected ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 min-h-[56px] ${
                      isSelected ? 'shadow-sm ring-1 ring-[var(--theme-accent-primary)]/40' : 'hover:border-[var(--theme-card-border-glow)]'
                    }`}
                  >
                    <div className="mt-0.5">{opt.icon}</div>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[var(--theme-text-title)] block leading-snug">
                        {opt.label}
                      </span>
                      <span className="text-[10.5px] text-[var(--theme-text-muted)] block mt-0.5 leading-snug">
                        {opt.hint}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Related Application Feature Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="support-related-feature"
              className="text-xs font-bold text-[var(--theme-text-body)] block"
            >
              {t.featureLabel}
            </label>
            <select
              id="support-related-feature"
              value={relatedFeature}
              onChange={(e) => setRelatedFeature(e.target.value)}
              style={{
                backgroundColor: 'var(--theme-input-bg)',
                borderColor: 'var(--theme-input-border)',
                color: 'var(--theme-text-title)',
              }}
              className="w-full min-h-[42px] py-2 px-3 rounded-xl border text-xs font-semibold cursor-pointer"
            >
              {SUPPORT_FEATURE_OPTIONS.map((feat) => {
                const featureLabelMap: Record<(typeof SUPPORT_FEATURE_OPTIONS)[number], string> = {
                  'General App': t.featGeneralApp,
                  'Explore Home & City Guide': t.featExploreHome,
                  'Photo Guide & OCR': t.featPhotoGuide,
                  'Discover Search': t.featDiscoverSearch,
                  'Nearby Attractions': t.featNearbyAttractions,
                  'AI Guide Chat': t.featAiGuideChat,
                  'Interactive Map': t.featInteractiveMap,
                  'Tour Journal': t.featTourJournal,
                  'Settings, Voice & Language': t.featSettingsVoiceLanguage,
                };
                return (
                  <option
                    key={feat}
                    value={feat}
                    style={{
                      backgroundColor: 'var(--theme-card-bg)',
                      color: 'var(--theme-text-title)',
                    }}
                  >
                    {featureLabelMap[feat] || feat}
                  </option>
                );
              })}
            </select>
          </div>

          {/* 3. User Email Behavior (Verified Session vs Guest) */}
          {sessionVerifiedEmail ? (
            <div
              id="support-verified-email-box"
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
              }}
              className="p-3 rounded-xl border space-y-1"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-bold text-[var(--theme-text-body)] flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{t.verifiedEmailLabel}</span>
                </span>
                <span
                  id="support-verified-email-value"
                  className="text-xs font-bold text-[var(--theme-accent-secondary)] break-all"
                >
                  {sessionVerifiedEmail}
                </span>
              </div>
              <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                {t.verifiedEmailNote}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="support-guest-email"
                className="text-xs font-bold text-[var(--theme-text-body)] flex items-center gap-1.5"
              >
                <Mail className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                <span>{t.guestEmailLabel}</span>
              </label>
              <input
                id="support-guest-email"
                type="email"
                required
                maxLength={160}
                value={guestEmail}
                onChange={(e) => {
                  setGuestEmail(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder={t.guestEmailPlaceholder}
                className="theme-input w-full min-h-[42px] py-2 px-3 text-xs font-semibold"
              />
              <p className="text-[11px] text-[var(--theme-text-muted)] leading-relaxed">
                {t.guestEmailNote}
              </p>
            </div>
          )}

          {/* 4. Clear Message / Description Field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="support-feedback-message"
                className="text-xs font-bold text-[var(--theme-text-body)]"
              >
                {t.messageLabel}
              </label>
              <span className="text-[10.5px] text-[var(--theme-text-muted)]">
                {message.length}/3000 {t.charactersLabel}
              </span>
            </div>
            <textarea
              id="support-feedback-message"
              required
              rows={4}
              maxLength={3000}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (formError) setFormError(null);
              }}
              placeholder={t.messagePlaceholder}
              className="theme-input w-full p-3 text-xs leading-relaxed resize-y min-h-[110px]"
            />
          </div>

          {/* 5. Optional Screenshot Attachment (Explicitly user-selected only) */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-[var(--theme-text-body)] block">
              {t.screenshotLabel}
            </span>
            <input
              ref={fileInputRef}
              id="support-screenshot-input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            {screenshotDataUrl ? (
              <div
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                }}
                className="p-2.5 rounded-xl border flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={screenshotDataUrl}
                    alt={screenshotName || 'Selected screenshot'}
                    className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0"
                  />
                  <span className="text-xs font-semibold text-[var(--theme-text-title)] truncate">
                    {screenshotName || 'screenshot.png'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveScreenshot}
                  className="min-h-[36px] px-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-[11px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t.screenshotRemove}</span>
                </button>
              </div>
            ) : (
              <button
                id="btn-support-attach-screenshot"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  backgroundColor: 'var(--theme-card-bg-subtle)',
                  borderColor: 'var(--theme-card-border)',
                  color: 'var(--theme-text-body)',
                }}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-dashed text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all"
              >
                <ImagePlus className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                <span>{t.screenshotChoose}</span>
              </button>
            )}
            <p className="text-[10.5px] text-[var(--theme-text-muted)] leading-relaxed">
              {t.screenshotPrivacyNote}
            </p>
          </div>

          {/* Inline Validation / Server Error */}
          {formError && (
            <div
              id="help-support-error-banner"
              role="alert"
              className="p-3 rounded-xl border border-rose-500/45 bg-rose-500/10 text-rose-200 text-xs flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Honest Fallback Banner if SMTP/Resend unconfigured or delivery failed — preserves all inputs */}
          {deliveryIssue && (
            <div
              id="help-support-fallback-banner"
              role="alert"
              className="p-3.5 rounded-xl border border-amber-500/45 bg-amber-500/10 text-amber-100 text-xs space-y-2.5"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold leading-relaxed">{deliveryIssue.message}</p>
                  {deliveryIssue.missingConfig && deliveryIssue.missingConfig.length > 0 && (
                    <p className="text-[11px] font-mono text-amber-200/90">
                      {t.missingConfigLabel}: {deliveryIssue.missingConfig.join(', ')}
                    </p>
                  )}
                  <p className="text-[11px] text-amber-200/80">{t.fallbackHint}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  id="btn-support-mailto-fallback"
                  href={deliveryIssue.mailtoUrl}
                  className="min-h-[40px] px-3.5 rounded-xl theme-btn-primary text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>{t.fallbackCta}</span>
                </a>
                {!deliveryIssue.isNotConfigured && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-[40px] px-3 rounded-xl theme-btn-secondary text-xs font-semibold cursor-pointer"
                  >
                    {t.retryButton}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Submit Action */}
          <div className="pt-1 flex justify-end">
            <button
              id="btn-support-submit"
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl theme-btn-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t.sendingButton}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{t.submitButton}</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
