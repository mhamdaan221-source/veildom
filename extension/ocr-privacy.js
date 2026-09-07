const luhnCheck = (value) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
};

export const classifyOcrText = (rawText) => {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/iu.test(text)) return "ocr-email";
  if (luhnCheck(text)) return "ocr-payment-card";

  const digits = text.replace(/\D/g, "");
  if (digits.length >= 10 && digits.length <= 15) return "ocr-phone";
  if (/\b(?:road|street|avenue|lane|sector|postcode|postal|pin\s*code)\b/iu.test(text)) return "ocr-address";
  // A standalone question label is structural context, not the secret. DOM
  // association masks its corresponding filled control. Florence should not
  // black out labels such as "Name of the Student" or "Application Number".
  if (/\b(?:full\s*name|name\s+of\s+the\s+student|student\s*name|applicant|application\s*(?:no|number|id)|registration\s*(?:no|number|id)|roll\s*(?:no|number)|admission\s*(?:no|number|id)|student\s*id|class\s*teacher|mobile\s*number|phone\s*number|email\s*address|account\s*(?:no|number)|password)\b/iu.test(text)) {
    const inlineValue = text.match(/:\s*(\S.{1,})$/u)?.[1];
    return inlineValue ? "ocr-labelled-value" : null;
  }
  if (/\b(?=[a-z0-9-]{8,}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]+\b/iu.test(text)) return "ocr-identifier";

  const looksLikeUppercaseName = /^[A-Z][A-Z.'-]+(?:\s+[A-Z][A-Z.'-]+){1,3}$/.test(text) &&
    !/\b(?:IDENTITY|CHECK|CONFIRM|ACCESS|LOGIN|LOGOUT|SUBMIT|CONTINUE|SAVE|CANCEL|DETAILS|CURRENT|PASSWORD|EMAIL|PHONE|ADDRESS|PAYMENT|SECURE|ACCOUNT|SETTINGS|MENU|HOME|WELCOME|FORM|STEP|REVIEW|COMPUTER|SCIENCE|ENGINEERING|PROGRAMME|DASHBOARD|SCHEDULE|LOCATION|CONTACT|APPLICATION|STUDENT|SEARCH|SERVICE|PROFILE)\b/u.test(text);
  if (looksLikeUppercaseName) return "ocr-person-name";
  return null;
};

export const ocrBoxToRegion = (item, imageWidth, imageHeight) => {
  const type = classifyOcrText(item.text || "");
  if (!type || !Array.isArray(item.box)) return null;

  let x1;
  let y1;
  let x2;
  let y2;
  if (item.box.length === 8) {
    const xs = item.box.filter((_, index) => index % 2 === 0);
    const ys = item.box.filter((_, index) => index % 2 === 1);
    x1 = Math.min(...xs);
    y1 = Math.min(...ys);
    x2 = Math.max(...xs);
    y2 = Math.max(...ys);
  } else if (item.box.length === 4) {
    [x1, y1, x2, y2] = item.box;
  } else {
    return null;
  }

  const x = Math.max(0, Math.floor(x1));
  const y = Math.max(0, Math.floor(y1));
  const width = Math.min(imageWidth - x, Math.ceil(x2 - x1));
  const height = Math.min(imageHeight - y, Math.ceil(y2 - y1));
  if (width <= 1 || height <= 1) return null;
  return { type, source: "florence-2", x, y, width, height };
};
