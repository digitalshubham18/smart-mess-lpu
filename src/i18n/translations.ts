/**
 * English / हिन्दी / ਪੰਜਾਬੀ. English is the source of truth and the fallback: a key missing from another language shows the
 * English text, so a half-translated screen is never blank or broken.
 *
 * COVERAGE (deliberately partial): the navigation, the sign-in page, the student's QR card, the meal-intention page and the
 * language picker. Everything else is still English. These translations were written by an AI model, not a professional
 * translator: have a native Hindi and Punjabi speaker review them before students rely on them.
 */
export type Lang = 'en' | 'hi' | 'pa'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
]

export const en = {
  'nav./dashboard': 'Dashboard', 'nav./college-overview': 'University Overview', 'nav./forecast': 'Forecast', 'nav./forecast-accuracy': 'Forecast Accuracy',
  'nav./meal-intention': 'Meal Intention', 'nav./attendance': 'Attendance', 'nav./meals': 'Meals', 'nav./menu-planner': 'Menu Planner', 'nav./food-waste': 'Food Waste',
  'nav./waste-analytics': 'Waste Analytics', 'nav./system-errors': 'System errors', 'nav./inventory': 'Inventory', 'nav./inventory-forecast': 'Inventory Forecast',
  'nav./suppliers': 'Suppliers', 'nav./procurement': 'Procurement', 'nav./students': 'Students', 'nav./hostels': 'Hostels', 'nav./messes': 'Messes', 'nav./staff': 'Staff',
  'nav./leaderboard': 'Leaderboard', 'nav./audit-log': 'Audit Log', 'nav./feedback': 'Feedback', 'nav./notifications': 'Notifications', 'nav./kitchen': 'Kitchen',
  'nav./reports': 'Reports', 'nav./sustainability': 'Sustainability', 'nav./simulator': 'What-If Simulator', 'nav./scenarios': 'Scenario Planner', 'nav./calendar': 'Calendar',
  'nav./finance': 'Finance', 'nav./settings': 'Settings',
  'login.welcome': 'Welcome back', 'login.uid': 'UID', 'login.password': 'Password', 'login.forgot': 'Forgot password?', 'login.signin': 'Sign in',
  'login.noUid': 'No UID handy? Your registered email works too.',
  'qr.show': "Show this to the counter staff. A screenshot won't work — the code changes every minute.",
  'qr.offlineBadge': 'Offline code — no internet needed ({s}s)',
  'qr.offlineNote': "Show this to the counter staff. It changes every minute and works once; the mess confirms it as soon as they're connected.",
  'qr.offlineReady': 'Also works with no internet on this phone.',
  'mi.title': 'Meal Intention', 'mi.subtitle': 'Let the kitchen know your plans for {date}.',
  'mi.closes': 'Marking closes at 2:00 AM · once marked, your choice locks', 'mi.requests': 'Your Requests', 'mi.pending': 'Pending', 'mi.cancel': 'Cancel',
  'profile.language': 'Language', 'profile.languageHelp': 'Changes the language of the main screens. The rest of the app is still in English.',
} as const
export type Key = keyof typeof en

const hi: Partial<Record<Key, string>> = {
  'nav./dashboard': 'डैशबोर्ड', 'nav./college-overview': 'विश्वविद्यालय अवलोकन', 'nav./forecast': 'पूर्वानुमान', 'nav./forecast-accuracy': 'पूर्वानुमान सटीकता',
  'nav./meal-intention': 'भोजन की सूचना', 'nav./attendance': 'उपस्थिति', 'nav./meals': 'भोजन', 'nav./menu-planner': 'मेन्यू योजना', 'nav./food-waste': 'खाद्य अपव्यय',
  'nav./waste-analytics': 'अपव्यय विश्लेषण', 'nav./system-errors': 'सिस्टम त्रुटियाँ', 'nav./inventory': 'भंडार', 'nav./inventory-forecast': 'भंडार पूर्वानुमान',
  'nav./suppliers': 'आपूर्तिकर्ता', 'nav./procurement': 'खरीद', 'nav./students': 'छात्र', 'nav./hostels': 'छात्रावास', 'nav./messes': 'मेस', 'nav./staff': 'स्टाफ',
  'nav./leaderboard': 'लीडरबोर्ड', 'nav./audit-log': 'ऑडिट लॉग', 'nav./feedback': 'प्रतिक्रिया', 'nav./notifications': 'सूचनाएँ', 'nav./kitchen': 'रसोई',
  'nav./reports': 'रिपोर्ट', 'nav./sustainability': 'स्थिरता', 'nav./simulator': 'क्या-अगर सिम्युलेटर', 'nav./scenarios': 'परिदृश्य योजना', 'nav./calendar': 'कैलेंडर',
  'nav./finance': 'वित्त', 'nav./settings': 'सेटिंग्स',
  'login.welcome': 'वापसी पर स्वागत है', 'login.uid': 'यूआईडी', 'login.password': 'पासवर्ड', 'login.forgot': 'पासवर्ड भूल गए?', 'login.signin': 'साइन इन करें',
  'login.noUid': 'UID याद नहीं? आपका पंजीकृत ईमेल भी चलेगा।',
  'qr.show': 'यह काउंटर स्टाफ़ को दिखाएँ। स्क्रीनशॉट काम नहीं करेगा — कोड हर मिनट बदलता है।',
  'qr.offlineBadge': 'ऑफ़लाइन कोड — इंटरनेट की ज़रूरत नहीं ({s} सेकंड)',
  'qr.offlineNote': 'यह काउंटर स्टाफ़ को दिखाएँ। यह हर मिनट बदलता है और एक ही बार चलता है; कनेक्ट होते ही मेस इसकी पुष्टि कर देगा।',
  'qr.offlineReady': 'इस फ़ोन पर बिना इंटरनेट के भी काम करता है।',
  'mi.title': 'भोजन की सूचना', 'mi.subtitle': '{date} के लिए रसोई को अपनी योजना बताइए।',
  'mi.closes': 'चिह्नित करना सुबह 2:00 बजे बंद हो जाता है · एक बार चुनने के बाद विकल्प लॉक हो जाता है', 'mi.requests': 'आपके अनुरोध', 'mi.pending': 'लंबित', 'mi.cancel': 'रद्द करें',
  'profile.language': 'भाषा', 'profile.languageHelp': 'यह मुख्य स्क्रीन की भाषा बदलता है। बाकी ऐप अभी अंग्रेज़ी में है।',
}
const pa: Partial<Record<Key, string>> = {
  'nav./dashboard': 'ਡੈਸ਼ਬੋਰਡ', 'nav./college-overview': 'ਯੂਨੀਵਰਸਿਟੀ ਸੰਖੇਪ', 'nav./forecast': 'ਪੂਰਵ-ਅਨੁਮਾਨ', 'nav./forecast-accuracy': 'ਪੂਰਵ-ਅਨੁਮਾਨ ਦੀ ਸ਼ੁੱਧਤਾ',
  'nav./meal-intention': 'ਖਾਣੇ ਦੀ ਸੂਚਨਾ', 'nav./attendance': 'ਹਾਜ਼ਰੀ', 'nav./meals': 'ਖਾਣਾ', 'nav./menu-planner': 'ਮੀਨੂ ਯੋਜਨਾ', 'nav./food-waste': 'ਖਾਣੇ ਦੀ ਬਰਬਾਦੀ',
  'nav./waste-analytics': 'ਬਰਬਾਦੀ ਵਿਸ਼ਲੇਸ਼ਣ', 'nav./system-errors': 'ਸਿਸਟਮ ਗਲਤੀਆਂ', 'nav./inventory': 'ਭੰਡਾਰ', 'nav./inventory-forecast': 'ਭੰਡਾਰ ਪੂਰਵ-ਅਨੁਮਾਨ',
  'nav./suppliers': 'ਸਪਲਾਇਰ', 'nav./procurement': 'ਖਰੀਦ', 'nav./students': 'ਵਿਦਿਆਰਥੀ', 'nav./hostels': 'ਹੋਸਟਲ', 'nav./messes': 'ਮੈੱਸ', 'nav./staff': 'ਸਟਾਫ਼',
  'nav./leaderboard': 'ਲੀਡਰਬੋਰਡ', 'nav./audit-log': 'ਆਡਿਟ ਲੌਗ', 'nav./feedback': 'ਫੀਡਬੈਕ', 'nav./notifications': 'ਸੂਚਨਾਵਾਂ', 'nav./kitchen': 'ਰਸੋਈ',
  'nav./reports': 'ਰਿਪੋਰਟਾਂ', 'nav./sustainability': 'ਸਥਿਰਤਾ', 'nav./simulator': 'ਕੀ-ਜੇ ਸਿਮੂਲੇਟਰ', 'nav./scenarios': 'ਦ੍ਰਿਸ਼ ਯੋਜਨਾ', 'nav./calendar': 'ਕੈਲੰਡਰ',
  'nav./finance': 'ਵਿੱਤ', 'nav./settings': 'ਸੈਟਿੰਗਾਂ',
  'login.welcome': 'ਜੀ ਆਇਆਂ ਨੂੰ', 'login.uid': 'ਯੂਆਈਡੀ', 'login.password': 'ਪਾਸਵਰਡ', 'login.forgot': 'ਪਾਸਵਰਡ ਭੁੱਲ ਗਏ?', 'login.signin': 'ਸਾਈਨ ਇਨ ਕਰੋ',
  'login.noUid': 'UID ਯਾਦ ਨਹੀਂ? ਤੁਹਾਡੀ ਰਜਿਸਟਰਡ ਈਮੇਲ ਵੀ ਚੱਲੇਗੀ।',
  'qr.show': 'ਇਹ ਕਾਊਂਟਰ ਸਟਾਫ਼ ਨੂੰ ਦਿਖਾਓ। ਸਕ੍ਰੀਨਸ਼ਾਟ ਕੰਮ ਨਹੀਂ ਕਰੇਗਾ — ਕੋਡ ਹਰ ਮਿੰਟ ਬਦਲਦਾ ਹੈ।',
  'qr.offlineBadge': 'ਔਫਲਾਈਨ ਕੋਡ — ਇੰਟਰਨੈੱਟ ਦੀ ਲੋੜ ਨਹੀਂ ({s} ਸਕਿੰਟ)',
  'qr.offlineNote': 'ਇਹ ਕਾਊਂਟਰ ਸਟਾਫ਼ ਨੂੰ ਦਿਖਾਓ। ਇਹ ਹਰ ਮਿੰਟ ਬਦਲਦਾ ਹੈ ਅਤੇ ਇੱਕ ਵਾਰ ਹੀ ਚੱਲਦਾ ਹੈ; ਕਨੈਕਟ ਹੁੰਦੇ ਹੀ ਮੈੱਸ ਇਸਦੀ ਪੁਸ਼ਟੀ ਕਰ ਦੇਵੇਗਾ।',
  'qr.offlineReady': 'ਇਸ ਫ਼ੋਨ ਉੱਤੇ ਬਿਨਾਂ ਇੰਟਰਨੈੱਟ ਦੇ ਵੀ ਕੰਮ ਕਰਦਾ ਹੈ।',
  'mi.title': 'ਖਾਣੇ ਦੀ ਸੂਚਨਾ', 'mi.subtitle': '{date} ਲਈ ਰਸੋਈ ਨੂੰ ਆਪਣੀ ਯੋਜਨਾ ਦੱਸੋ।',
  'mi.closes': 'ਮਾਰਕ ਕਰਨਾ ਸਵੇਰੇ 2:00 ਵਜੇ ਬੰਦ ਹੋ ਜਾਂਦਾ ਹੈ · ਇੱਕ ਵਾਰ ਚੁਣਨ ਤੋਂ ਬਾਅਦ ਚੋਣ ਲੌਕ ਹੋ ਜਾਂਦੀ ਹੈ', 'mi.requests': 'ਤੁਹਾਡੀਆਂ ਬੇਨਤੀਆਂ', 'mi.pending': 'ਬਕਾਇਆ', 'mi.cancel': 'ਰੱਦ ਕਰੋ',
  'profile.language': 'ਭਾਸ਼ਾ', 'profile.languageHelp': 'ਇਹ ਮੁੱਖ ਸਕ੍ਰੀਨਾਂ ਦੀ ਭਾਸ਼ਾ ਬਦਲਦਾ ਹੈ। ਬਾਕੀ ਐਪ ਹਾਲੇ ਅੰਗਰੇਜ਼ੀ ਵਿੱਚ ਹੈ।',
}
export const DICTIONARIES: Record<Lang, Partial<Record<Key, string>>> = { en, hi, pa }

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang][key] ?? en[key]
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : text
}
