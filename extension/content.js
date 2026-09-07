const isVisible = (element) => {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
};

const getReferencedLabelText = (element) => {
  const ids = element.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) || [];
  return ids
    .map((id) => document.getElementById(id)?.innerText?.trim())
    .filter(Boolean)
    .join(" ");
};

const getLabel = (element) => {
  const ariaLabel = element.getAttribute("aria-label");
  const referencedLabel = getReferencedLabelText(element);
  // Google Forms commonly uses a generic aria-label such as "Your answer"
  // and keeps the actual question in aria-labelledby.
  if (referencedLabel) return referencedLabel;
  if (ariaLabel) return ariaLabel.trim();

  if (element.labels?.length) {
    return Array.from(element.labels)
      .map((label) => label.innerText.trim())
      .filter(Boolean)
      .join(" ");
  }

  return (element.innerText || element.getAttribute("placeholder") || element.name || "Unlabelled element").trim();
};

const getLocalControlContext = (element) => {
  const nativeLabels = element.labels
    ? Array.from(element.labels).map((label) => label.innerText).join(" ")
    : "";
  const labelledBy = getReferencedLabelText(element);
  const questionContainer = element.closest("fieldset, [role='listitem'], [role='group'], [data-params], [class*='question'], [class*='field']");
  // This text is used only for local classification. It is never added to the
  // safe element map or any network payload.
  const nearbyQuestionText = questionContainer?.innerText?.slice(0, 600) || "";
  return [
    element.getAttribute("aria-label"),
    labelledBy,
    nativeLabels,
    element.getAttribute("placeholder"),
    element.name,
    element.id,
    element.autocomplete,
    nearbyQuestionText
  ].filter(Boolean).join(" ");
};

const getRole = (element) => {
  if (element.getAttribute("role")) return element.getAttribute("role");
  if (element.tagName === "BUTTON") return "button";
  if (element.tagName === "A") return "link";
  if (element.tagName === "SELECT") return "combobox";
  if (element.tagName === "TEXTAREA") return "textbox";
  if (element.tagName === "INPUT") {
    if (element.type === "checkbox") return "checkbox";
    if (element.type === "radio") return "radio";
    return "textbox";
  }
  return element.tagName.toLowerCase();
};

let elementRegistry = new Map();
let actionOverlay = null;

const clearActionOverlay = () => {
  actionOverlay?.remove();
  actionOverlay = null;
};

const rectToPlainObject = (rect) => ({
  x: Math.round(rect.x),
  y: Math.round(rect.y),
  width: Math.round(rect.width),
  height: Math.round(rect.height)
});

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

const classifyTextMatch = (value) => {
  if (/^[\w.%+-]+@[\w.-]+\.[a-z]{2,}$/iu.test(value)) return "email";
  if (luhnCheck(value)) return "payment-card";

  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 12) return "phone";
  return null;
};

const textMatchRegions = () => {
  const regions = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || !isVisible(parent) || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const pattern = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{6,}\d)/giu;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (const match of node.nodeValue.matchAll(pattern)) {
      const type = classifyTextMatch(match[0]);
      if (!type) continue;

      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) regions.push({ type, ...rectToPlainObject(rect) });
      }
    }
  }

  return regions;
};

const isLikelyInterfaceText = (text) =>
  /\b(?:IDENTITY|CHECK|CONFIRM|ACCESS|LOGIN|LOGOUT|SUBMIT|CONTINUE|SAVE|CANCEL|DETAILS|CURRENT|PASSWORD|EMAIL|PHONE|ADDRESS|PAYMENT|SECURE|ACCOUNT|SETTINGS|MENU|HOME|WELCOME|FORM|STEP|REVIEW|DASHBOARD|SCHEDULE|LOCATION|CONTACT|APPLICATION|STUDENT|SEARCH|SERVICE|PROFILE)\b/u.test(text.toUpperCase());

const classifySemanticText = (rawText) => {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/\b(?:road|street|avenue|lane|sector|postcode|postal|pin\s*code)\b/iu.test(text)) return "address";
  if (/\b(?:full\s*name|student\s*name|applicant|application\s*(?:no|number|id)|registration\s*(?:no|number|id)|roll\s*(?:no|number)|class\s*teacher|account\s*(?:no|number))\b/iu.test(text)) {
    return "sensitive-labelled-text";
  }
  if (/\b(?=[a-z0-9-]{8,}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9-]+\b/iu.test(text)) return "identifier";

  const looksLikeUppercaseName = /^[A-Z][A-Z.'-]+(?:\s+[A-Z][A-Z.'-]+){1,3}$/.test(text) &&
    !isLikelyInterfaceText(text) &&
    !/\b(?:COMPUTER|SCIENCE|ENGINEERING|PROGRAMME)\b/u.test(text);
  if (looksLikeUppercaseName) return "person-name";
  return null;
};

const isStandaloneSensitiveLabel = (rawText) => {
  const text = rawText.replace(/\s+/g, " ").replace(/[\s*.:\-]+$/g, "").trim();
  if (!text || text.length > 100) return false;
  const sensitiveLabel = /\b(?:full\s*name|name\s+of\s+the\s+student|student\s*name|applicant(?:\s+name)?|application\s*(?:no|number|id)|registration\s*(?:no|number|id)|roll\s*(?:no|number)|admission\s*(?:no|number|id)|enrolment\s*(?:no|number|id)|enrollment\s*(?:no|number|id)|student\s*id|email(?:\s+address)?|phone(?:\s+number)?|mobile(?:\s+number)?|address|account\s*(?:no|number)|password)\b/iu;
  const containsInlineValue = /:\s*\S{2,}/u.test(rawText) || /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/iu.test(rawText);
  return sensitiveLabel.test(text) && !containsInlineValue;
};

const semanticTextRegions = () => {
  const regions = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.nodeValue?.trim() || !parent || !isVisible(parent) || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return classifySemanticText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const type = classifySemanticText(node.nodeValue);
    // Question labels explain the form structure and are safe to retain. The
    // associated filled control is masked separately below.
    if (type === "sensitive-labelled-text" && isStandaloneSensitiveLabel(node.nodeValue)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) regions.push({ type, ...rectToPlainObject(rect) });
    }

    if (type === "sensitive-labelled-text") {
      const container = node.parentElement.closest("p, li, tr, dd, [class*='row'], [class*='field'], [class*='detail']");
      if (container && isVisible(container)) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.height <= 120 && rect.width <= window.innerWidth) {
          regions.push({ type: "sensitive-labelled-row", ...rectToPlainObject(rect) });
        }
      }
    }
  }
  return regions;
};

const labelledRegions = () => {
  const regions = [];
  const sensitiveLabel = /(applicant|full\s*name|email|phone|mobile|address|street|postcode|postal|card|payment|account|password)/iu;

  for (const term of document.querySelectorAll("dt")) {
    const value = term.nextElementSibling;
    if (!value || !sensitiveLabel.test(term.textContent) || !isVisible(value)) continue;
    regions.push({
      type: term.textContent.trim().toLowerCase().replace(/\s+/g, "-"),
      ...rectToPlainObject(value.getBoundingClientRect())
    });
  }

  for (const headingRow of document.querySelectorAll(".profile-heading-row")) {
    if (!/applicant/iu.test(headingRow.textContent)) continue;
    const name = headingRow.querySelector("h1, h2, h3, h4");
    if (name && isVisible(name)) {
      regions.push({ type: "name", ...rectToPlainObject(name.getBoundingClientRect()) });
    }
  }

  return regions;
};

const isSensitiveControl = (element) => {
  const sensitiveHint = /(?:\bname\b|student\s*name|name\s+of\s+the\s+student|applicant|application\s*(?:no|number|id)|registration\s*(?:no|number|id)|roll\s*(?:no|number)|admission\s*(?:no|number|id)|enrolment\s*(?:no|number|id)|enrollment\s*(?:no|number|id)|student\s*id|email|phone|mobile|address|street|postcode|postal|card|payment|account|password|passcode|secret|token)/iu;
  const alwaysSensitiveTypes = new Set(["password", "email", "tel"]);
  const hints = [element.type, getLocalControlContext(element)].filter(Boolean).join(" ");
  return alwaysSensitiveTypes.has(element.type) || sensitiveHint.test(hints);
};

const isFilledTextControl = (element) => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  const excludedInputTypes = new Set(["button", "submit", "reset", "checkbox", "radio", "file", "range", "color", "hidden", "image"]);
  if (element instanceof HTMLInputElement && excludedInputTypes.has(element.type)) return false;
  return typeof element.value === "string" && element.value.trim().length > 0;
};

const isDisabledControl = (element) =>
  element.disabled === true ||
  element.getAttribute("aria-disabled") === "true" ||
  (typeof element.matches === "function" && element.matches(":disabled"));

const isSafeClickTarget = (element) =>
  element instanceof HTMLButtonElement ||
  (element instanceof HTMLInputElement && ["button", "submit"].includes(element.type)) ||
  element.getAttribute("role") === "button";

const sensitiveInputRegions = () => {
  return Array.from(document.querySelectorAll("input, textarea, select"))
    // A filled text control contains user-provided data. Mask it even when a
    // custom form framework hides or mislabels its semantics. This prevents a
    // missed name or short student ID from reaching the sanitized screenshot.
    .filter((element) => isVisible(element) && (isSensitiveControl(element) || isFilledTextControl(element)))
    .map((element) => ({
      type: element.type === "password" ? "password" : isFilledTextControl(element) ? "filled-form-value" : "sensitive-field",
      ...rectToPlainObject(element.getBoundingClientRect())
    }));
};

const overlaps = (left, right) =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

const clipRegionToViewport = (region) => {
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(window.innerWidth, region.x + region.width);
  const bottom = Math.min(window.innerHeight, region.y + region.height);
  return {
    ...region,
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
};

const uncertainTextCandidates = (knownRegions) => {
  const candidates = [];
  let totalCharacters = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      const text = node.nodeValue?.replace(/\s+/g, " ").trim();
      if (!text || text.length < 2 || text.length > 180 || !parent || !isVisible(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "OPTION"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest("button, nav, [role='navigation'], [aria-hidden='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
      if (isLikelyInterfaceText(text)) return NodeFilter.FILTER_REJECT;
      if (classifySemanticText(text) || classifyTextMatch(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (walker.nextNode() && candidates.length < 120 && totalCharacters < 6000) {
    const node = walker.currentNode;
    const text = node.nodeValue.replace(/\s+/g, " ").trim();
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = rectToPlainObject(range.getBoundingClientRect());
    if (rect.width <= 0 || rect.height <= 0 || rect.x >= window.innerWidth || rect.y >= window.innerHeight) continue;

    const clipped = {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.min(rect.width, window.innerWidth - Math.max(0, rect.x)),
      height: Math.min(rect.height, window.innerHeight - Math.max(0, rect.y))
    };
    if (knownRegions.some((region) => overlaps(region, clipped))) continue;

    candidates.push({ id: `t_${candidates.length + 1}`, text, rect: clipped });
    totalCharacters += text.length;
  }

  return candidates;
};

const buildPrivacyMap = () => {
  const protectedInputRegions = sensitiveInputRegions();
  const candidates = [...protectedInputRegions, ...labelledRegions(), ...textMatchRegions(), ...semanticTextRegions()]
    .filter((region) => region.width > 0 && region.height > 0)
    .filter((region) => region.x < window.innerWidth && region.y < window.innerHeight)
    .map(clipRegionToViewport)
    .filter((region) => region.width > 0 && region.height > 0);

  const regions = [];
  for (const candidate of candidates) {
    const coveringRegion = regions.find((region) =>
      overlaps(region, candidate) &&
      region.x <= candidate.x && region.y <= candidate.y &&
      region.x + region.width >= candidate.x + candidate.width &&
      region.y + region.height >= candidate.y + candidate.height
    );
    if (!coveringRegion) regions.push(candidate);
  }

  return {
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    regions,
    // Geometry-only local proof. No form value or label is included. The
    // popup refuses to produce a sendable preview if any guarded field is not
    // covered by a final DOM mask.
    guardedFields: protectedInputRegions
      .map(clipRegionToViewport)
      .filter((region) => region.width > 0 && region.height > 0)
      .map(({ type, x, y, width, height }) => ({ type, x, y, width, height })),
    // Candidate text is consumed only by the extension's local NER worker. It
    // is removed before the privacy report or any network payload is created.
    textCandidates: uncertainTextCandidates(regions),
    imageRegions: Array.from(document.images)
      .filter(isVisible)
      .map((image) => ({
        alt: image.alt || "Unlabelled image",
        ...rectToPlainObject(image.getBoundingClientRect())
      }))
  };
};

const buildElementMap = () => {
  const selector = "button, a[href], input, select, textarea, [role='button'], [tabindex]:not([tabindex='-1'])";

  elementRegistry = new Map();

  return Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .map((element, index) => {
      const rect = element.getBoundingClientRect();
      const id = `e_${index + 1}`;
      elementRegistry.set(id, element);
      return {
        id,
        role: getRole(element),
        label: getLabel(element),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        visible: true,
        enabled: !isDisabledControl(element),
        sensitive: isSensitiveControl(element)
      };
    });
};

const previewAction = (action) => {
  clearActionOverlay();
  const target = elementRegistry.get(action.targetId);
  if (!target || !isVisible(target)) throw new Error("The proposed target is no longer visible.");
  if (!isSafeClickTarget(target)) throw new Error("The proposed target is not an approved button control.");
  if (isDisabledControl(target)) throw new Error("The proposed target is disabled.");
  if (isSensitiveControl(target)) throw new Error("The proposed target is sensitive and cannot be clicked.");

  const rect = target.getBoundingClientRect();
  actionOverlay = document.createElement("div");
  actionOverlay.id = "pva-action-preview";
  actionOverlay.setAttribute("aria-hidden", "true");
  Object.assign(actionOverlay.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: `${Math.max(0, rect.left - 4)}px`,
    top: `${Math.max(0, rect.top - 4)}px`,
    width: `${rect.width + 8}px`,
    height: `${rect.height + 8}px`,
    border: "3px solid #bd93f9",
    borderRadius: "11px",
    background: "rgba(189, 147, 249, 0.10)",
    boxShadow: "0 0 0 5px rgba(189, 147, 249, 0.18), 0 12px 34px rgba(0, 0, 0, 0.34)",
    pointerEvents: "none"
  });

  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "absolute",
    right: "0",
    bottom: "calc(100% + 10px)",
    width: "max-content",
    maxWidth: "280px",
    padding: "10px 12px",
    border: "1px solid #6272a4",
    borderRadius: "10px",
    color: "#f8f8f2",
    background: "linear-gradient(145deg, #343746, #282a36)",
    boxShadow: "0 12px 30px rgba(0, 0, 0, 0.32)",
    font: "600 12px/1.35 Inter, system-ui, sans-serif"
  });

  const labelKicker = document.createElement("div");
  labelKicker.textContent = "PRIVATE VISION AGENT";
  Object.assign(labelKicker.style, {
    marginBottom: "3px",
    color: "#bd93f9",
    fontSize: "9px",
    fontWeight: "850",
    letterSpacing: "0.11em"
  });

  const labelText = document.createElement("div");
  labelText.textContent = "Proposed click - approval required";
  Object.assign(labelText.style, {
    color: "#f8f8f2",
    fontSize: "12px",
    fontWeight: "750"
  });
  label.append(labelKicker, labelText);
  actionOverlay.append(label);
  document.documentElement.append(actionOverlay);
  return { targetId: action.targetId, label: getLabel(target) };
};

const executeAction = (action) => {
  const target = elementRegistry.get(action.targetId);
  if (!target || !isVisible(target)) throw new Error("The approved target is no longer visible.");
  if (action.type !== "click") throw new Error(`Action type ${action.type} is not allowed in this demo.`);
  if (!isSafeClickTarget(target)) throw new Error("Only native buttons, button inputs, and ARIA buttons can be clicked.");
  if (isDisabledControl(target)) throw new Error("The target button is disabled.");
  if (isSensitiveControl(target)) throw new Error("The target is sensitive and cannot be clicked.");

  clearActionOverlay();
  if (typeof target.focus === "function") target.focus({ preventScroll: true });
  target.click();
  return { executed: true, targetId: action.targetId };
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message.type === "BUILD_ELEMENT_MAP") {
      sendResponse({
        title: document.title,
        origin: window.location.origin,
        elements: buildElementMap()
      });
      return;
    }

    if (message.type === "PREVIEW_ACTION") {
      sendResponse({ ok: true, preview: previewAction(message.action) });
      return;
    }

    if (message.type === "BUILD_PRIVACY_MAP") {
      sendResponse({ ok: true, privacyMap: buildPrivacyMap() });
      return;
    }

    if (message.type === "EXECUTE_ACTION") {
      sendResponse({ ok: true, result: executeAction(message.action) });
    }
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }
});
