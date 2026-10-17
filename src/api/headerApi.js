/**
 * Get the message window from a native tab (used for installation on message headers).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The message window or null if not found.
 */
function getMessageWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name === "mail3PaneTab") {
    if (
      nativeTab.chromeBrowser.contentWindow.multiMessageBrowser &&
      !nativeTab.chromeBrowser.contentWindow.multiMessageBrowser.hidden
    ) {
      return nativeTab.chromeBrowser.contentWindow.multiMessageBrowser
        .contentWindow;
    }
    return nativeTab.chromeBrowser.contentWindow.messageBrowser.contentWindow;
  } else if (nativeTab.mode && nativeTab.mode.name === "mailMessageTab") {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser?.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return null;
  }
}

/**
 * Get the content window from a native tab (used for installation on inbox list).
 *
 * @param {Object} nativeTab - The native tab object.
 * @returns {Object|null} - The content window or null if not found.
 */
function getContentWindow(nativeTab) {
  if (nativeTab instanceof Ci.nsIDOMWindow) {
    return nativeTab.messageBrowser.contentWindow;
  } else if (
    nativeTab.mode &&
    (nativeTab.mode.name === "mail3PaneTab" ||
      nativeTab.mode.name === "mail3Pane")
  ) {
    return nativeTab.chromeBrowser.contentWindow;
  } else if (nativeTab.browser?.contentWindow) {
    return nativeTab.browser.contentWindow;
  } else {
    return nativeTab.browser.contentWindow;
  }
}

/**
 * Extracts email addresses from Thunderbird conversation popups.
 *
 * @param {Object} window - The window object.
 * @returns {Object} - An object containing styleLeftValues and popupValues.
 */
async function extractMailsThunderbirdConversation(window) {
  const { document } = window;
  const popupContainer = document.getElementById("popup-container");
  let popups = popupContainer.childNodes;

  let retryCount = 0;
  while (popups.length === 0 && retryCount < 20) {
    console.warn("Waiting for popups to load...");
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    popups = popupContainer.childNodes;
    retryCount++;
  }

  if (popups.length === 0) {
    console.error("No popups found in the popup container.");
    return null;
  }

  /**
   * Extracts the email address from a popup.
   *
   * @param {HTMLElement} popup - The popup element.
   * @returns {string|null} - The email address or null if not found.
   */
  function extractMailFromPopup(popup) {
    const mail = popup.querySelector(".authorEmailAddress");
    if (mail) {
      return mail.textContent;
    }
    return null;
  }

  const styleLeftValues = {};
  const popupValues = [];

  for (const popup of popups) {
    const styleLeft = popup.style.left;
    if (styleLeftValues[styleLeft]) {
      styleLeftValues[styleLeft]++;
    } else {
      styleLeftValues[styleLeft] = 1;
    }

    const mail = extractMailFromPopup(popup);
    popupValues.push({
      left: styleLeft,
      mail: mail,
    });
  }

  return {
    styleLeftValues: styleLeftValues,
    popupValues: popupValues,
  };
}

/**
 * Gets the Thunderbird version number
 * @returns {number} - The major version number of Thunderbird
 */
function getThunderbirdVersion() {
  try {
    const appInfo = Services.appinfo;
    const version = appInfo.version;
    const majorVersion = parseInt(version.split(".")[0], 10);
    return majorVersion;
  } catch (error) {
    console.error("Error getting Thunderbird version:", error);
    // Default to a high version number to use canvas approach if detection fails
    return 145;
  }
}

const AVATAR_CLASS = "autoprofilepicture-item";
const AVATAR_DATA_QUERY = `[data-auto-profile-picture="true"], .${AVATAR_CLASS}`;
const SVG_DATA_PREFIX = "data:image/svg+xml";
const DEFAULT_FALLBACK_ICON =
  "chrome://messenger/skin/addressbook/icons/contact-generic.svg";
const INITIALS_PREFIX = "//INITIAL:";
const DATA_URL_REGEX = /^data:([^;,]+)(;base64)?,(.*)$/;
const ROW_AVATAR_REFERENCE = Symbol("autoProfilePictureRowAvatar");
const RECIPIENT_AVATAR_OWNER = "auto-profile-picture";
const EXTENSION_AVATAR_SELECTOR = `.recipient-avatar[data-auto-profile-picture-owner="${RECIPIENT_AVATAR_OWNER}"]`;

function hasInitialsValue(value) {
  return typeof value === "string" && value.includes(INITIALS_PREFIX);
}

function extractInitials(value) {
  return value.replace(INITIALS_PREFIX, "");
}

function markAvatarElement(element) {
  element.classList.add(AVATAR_CLASS);
  element.dataset.autoProfilePicture = "true";
  return element;
}

function createAvatarCanvas(doc, size, borderRadius = "50%") {
  const canvas = doc.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.borderRadius = borderRadius;
  return markAvatarElement(canvas);
}

function createAvatarImage(doc, url, attrs = {}) {
  const img = markAvatarElement(doc.createElement("img"));
  img.src = url;
  img.alt = attrs.alt || "Profile picture";
  for (const [attr, value] of Object.entries(attrs)) {
    if (attr === "alt") {
      continue;
    }
    if (value !== undefined && value !== null) {
      img.setAttribute(attr, value);
    }
  }
  return img;
}

function cacheRecipientAvatar(row, avatar) {
  if (!row || !avatar) {
    return;
  }
  row[ROW_AVATAR_REFERENCE] = avatar;
}

function getExtensionRecipientAvatar(row) {
  if (!row) {
    return null;
  }
  const cached = row[ROW_AVATAR_REFERENCE];
  if (cached?.isConnected) {
    return cached;
  }
  const existing = row.querySelector(EXTENSION_AVATAR_SELECTOR);
  if (existing) {
    cacheRecipientAvatar(row, existing);
    return existing;
  }
  return null;
}

function ensureAvatarOwnership(element) {
  if (element) {
    element.dataset.autoProfilePictureOwner = RECIPIENT_AVATAR_OWNER;
  }
  return element;
}

function cleanupDuplicateRecipientAvatars(container, keepAvatar = null) {
  if (!container) {
    return;
  }
  const duplicates = container.querySelectorAll(EXTENSION_AVATAR_SELECTOR);
  for (const avatar of duplicates) {
    if (avatar !== keepAvatar) {
      avatar.remove();
    }
  }
}

function mountRecipientAvatar(row, avatar) {
  if (!row || !avatar) {
    return;
  }
  const threadCardRow = row.querySelector(".thread-card-row");
  if (threadCardRow) {
    const contentColumn =
      threadCardRow.closest(".thread-card-column") ||
      threadCardRow.parentElement;
    const cardContainer = contentColumn?.parentElement;

    if (cardContainer && contentColumn) {
      if (contentColumn.style.display) {
        contentColumn.style.display = "";
      }
      if (contentColumn.style.flexDirection) {
        contentColumn.style.flexDirection = "";
      }

      // Found through its indicator image rather than the read-status-column
      // class, which only Thunderbird 155 and later set on this column.
      const readStatusColumn = cardContainer
        .querySelector(".read-status")
        ?.closest(".thread-card-column");
      if (readStatusColumn) {
        if (readStatusColumn.style.display) {
          readStatusColumn.style.display = "";
        }
        if (readStatusColumn.style.flexDirection) {
          readStatusColumn.style.flexDirection = "";
        }
      }

      cleanupDuplicateRecipientAvatars(cardContainer, avatar);

      if (
        avatar.parentNode !== cardContainer ||
        avatar.nextElementSibling !== contentColumn
      ) {
        cardContainer.insertBefore(avatar, contentColumn);
      }
      return;
    }
  }

  const correspondentColumn = row.querySelector(".correspondentcol-column");
  if (correspondentColumn) {
    cleanupDuplicateRecipientAvatars(correspondentColumn, avatar);
    if (correspondentColumn.firstChild !== avatar) {
      correspondentColumn.insertBefore(avatar, correspondentColumn.firstChild);
    }
  }
}

function isSvgDataUrl(dataUrl) {
  return typeof dataUrl === "string" && dataUrl.startsWith(SVG_DATA_PREFIX);
}

/**
 * Removes all existing avatar elements from a container.
 * @param {HTMLElement} container - The container element to remove avatars from.
 */
function removeAvatarElements(container) {
  const avatarElements = container.querySelectorAll(AVATAR_DATA_QUERY);
  if (avatarElements.length === 0) {
    while (container.firstChild) {
      container.firstChild.remove();
    }
    return;
  }
  for (const element of avatarElements) {
    element.remove();
  }
}

function normalizeAvatarPayload(payload, fallbackIdentifier = null) {
  if (payload && typeof payload === "object") {
    const value = payload.value ?? payload.url ?? "";
    return {
      value,
      color: payload.color ?? null,
      identifier: payload.identifier ?? fallbackIdentifier ?? null,
    };
  }
  return {
    value: typeof payload === "string" ? payload : "",
    color: null,
    identifier: fallbackIdentifier ?? null,
  };
}

function determinePayloadType(value) {
  if (!value) {
    return "empty";
  }
  return hasInitialsValue(value) ? "initials" : "image";
}

function rememberAvatarMetadata(
  element,
  { identifier, type, value, color = null },
) {
  if (!element) {
    return;
  }
  if (identifier) {
    element.dataset.autoProfilePictureIdentifier = identifier;
  } else {
    delete element.dataset.autoProfilePictureIdentifier;
  }
  element.dataset.autoProfilePictureType = type;
  element.dataset.autoProfilePictureValue = value || "";
  if (color) {
    element.dataset.autoProfilePictureColor = color;
  } else {
    delete element.dataset.autoProfilePictureColor;
  }
}

function shouldSkipAvatarUpdate(
  element,
  { identifier, type, value, color = null, isTemporary = false },
) {
  if (!element || !identifier) {
    return false;
  }
  const { dataset } = element;
  if (dataset.autoProfilePictureIdentifier !== identifier) {
    return false;
  }
  const currentType = dataset.autoProfilePictureType;
  const currentValue = dataset.autoProfilePictureValue;
  const currentColor = dataset.autoProfilePictureColor || "";

  if (type === "initials") {
    if (currentType === "image") {
      return isTemporary;
    }
    return (
      currentType === "initials" &&
      currentValue === value &&
      currentColor === (color || "")
    );
  }

  if (type === "image") {
    return currentType === "image" && currentValue === value;
  }

  if (type === "empty") {
    return currentType === "empty";
  }

  return false;
}

function drawStaticImageToCanvas(canvas, iconUrl, size) {
  const img = canvas.ownerDocument.createElement("img");
  const handleLoad = () => {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
  };
  img.addEventListener("load", handleLoad, { once: true });
  img.src = iconUrl;
}

/**
 * Helper function to draw a data URL directly to canvas without triggering CSP.
 * @param {string} dataUrl - The data URL to draw
 * @param {HTMLCanvasElement} canvas - The canvas element to draw to
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @param {Window} win - The window object for accessing global functions
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
async function drawDataUrlToCanvas(dataUrl, canvas, width, height, win) {
  try {
    // SVG is markup, usually written by the sender, and this document is
    // privileged chrome: importing it would let its <style> restyle the whole
    // page. The background rasterizes SVG before sending it, so one reaching
    // here is refused rather than trusted.
    if (isSvgDataUrl(dataUrl)) {
      console.error("Refusing to draw an SVG avatar into a chrome document");
      return false;
    }

    const matches = dataUrl.match(DATA_URL_REGEX);
    if (!matches) {
      console.error("Invalid data URL format");
      return false;
    }

    const mimeType = matches[1];
    const isBase64 = matches[2] === ";base64";
    const payload = matches[3];
    const atobFn = win.atob || atob;
    const binaryString = isBase64
      ? atobFn(payload)
      : decodeURIComponent(payload);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const BlobConstructor = win.Blob || Blob;
    const blob = new BlobConstructor([bytes], { type: mimeType });
    const createImageBitmapFn = win.createImageBitmap || createImageBitmap;
    const imageBitmap = await createImageBitmapFn(blob);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(imageBitmap, 0, 0, width, height);
    return true;
  } catch (error) {
    console.error("Error drawing data URL to canvas:", error);
    return false;
  }
}

/**
 * Installs avatars for Thunderbird conversation.
 *
 * @param {Object} window - The window object.
 * @param {Object} payload - The payload object containing URLs and data.
 */
async function installConversation(window, payload) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  async function insertPictureInPopup(popup, url) {
    const avatar = popup.querySelector(".authorPicture");
    if (!avatar) return;

    removeAvatarElements(avatar);

    if (!url || url === "") {
      if (useCanvas) {
        const canvas = createAvatarCanvas(document, 48, "8px");
        avatar.appendChild(canvas);
        drawStaticImageToCanvas(canvas, DEFAULT_FALLBACK_ICON, 48);
      } else {
        avatar.appendChild(
          createAvatarImage(document, DEFAULT_FALLBACK_ICON, {
            alt: "Default contact picture",
          }),
        );
      }
      return;
    }

    if (useCanvas) {
      const canvas = createAvatarCanvas(document, 48, "8px");
      avatar.appendChild(canvas);
      await drawDataUrlToCanvas(url, canvas, 48, 48, window);
    } else {
      avatar.appendChild(createAvatarImage(document, url));
    }
  }

  async function replaceAuthorPictureInMessage(message, url) {
    if (!url || url === "") {
      const wrongInitials = message.querySelector("abbr.auto-profile-picture");
      if (wrongInitials) {
        wrongInitials.classList.remove("auto-profile-picture");
        wrongInitials.classList.add("contactInitials");
        removeAvatarElements(wrongInitials);
        if (!useCanvas) {
          wrongInitials.style.backgroundImage = null;
        }
      }
      return;
    }

    if (useCanvas) {
      const targetElement =
        message.querySelector(".contactInitials") ||
        message.querySelector(".auto-profile-picture");
      if (targetElement) {
        targetElement.classList.remove("contactInitials");
        targetElement.classList.add("contactAvatar");
        targetElement.classList.add("auto-profile-picture");
        targetElement.textContent = "";

        targetElement.style.background = null;

        removeAvatarElements(targetElement);

        const canvas = createAvatarCanvas(document, 32);
        targetElement.appendChild(canvas);

        await drawDataUrlToCanvas(url, canvas, 32, 32, window);
      } else {
        console.error("No contactInitials or auto-profile-picture found");
      }
    } else {
      // TB < 145 and TB 146+: Use background-image approach
      const contactInitials = message.querySelector(".contactInitials");
      if (contactInitials) {
        contactInitials.classList.remove("contactInitials");
        contactInitials.classList.add("contactAvatar");
        contactInitials.classList.add("auto-profile-picture");
        // Clear background color (oklch) when removing initials
        contactInitials.style.background = null;
        contactInitials.style.backgroundImage = `url("${url}")`;
        contactInitials.textContent = "\u00A0";
      } else {
        const avatarElement = message.querySelector(".auto-profile-picture");
        if (avatarElement) {
          // Clear background color (oklch) when removing initials
          avatarElement.style.background = null;
          avatarElement.style.backgroundImage = `url("${url}")`;
          avatarElement.textContent = "\u00A0";
        } else {
          console.error("No contactInitials or auto-profile-picture found");
        }
      }
    }
  }

  const { document } = window;

  const conversationMailCache = payload.urls;

  const styleLeftValues = payload.data.styleLeftValues;
  const popupValues = payload.data.popupValues;

  const popupContainer = document.getElementById("popup-container");
  const popups = popupContainer.querySelectorAll(".fade-popup");

  let popupNumber = 0;
  for (const popup of popups) {
    const mail = popupValues[popupNumber].mail;
    if (mail) {
      await insertPictureInPopup(popup, conversationMailCache[mail]);
    }
    popupNumber++;
  }

  const mostCommonLeftValue = Object.keys(styleLeftValues).reduce((a, b) => {
    if (styleLeftValues[a] === styleLeftValues[b]) {
      const aParsed = parseFloat(a.replace("px", ""));
      const bParsed = parseFloat(b.replace("px", ""));
      return aParsed < bParsed ? a : b;
    }
    return styleLeftValues[a] > styleLeftValues[b] ? a : b;
  });

  const popupsWithMostCommonLeftValue = popupValues.filter(
    (popup) => popup.left === mostCommonLeftValue,
  );

  const messageList = document.getElementById("messageList");
  const messages = messageList.querySelectorAll(".message");

  let messageNumber = 0;
  for (const message of messages) {
    const mail = popupsWithMostCommonLeftValue[messageNumber].mail;
    if (mail) {
      await replaceAuthorPictureInMessage(message, conversationMailCache[mail]);
    }
    messageNumber++;
  }
}

/**
 * Installs an avatar or initials on the message header.
 *
 * @param {Object} window - The window object.
 * @param {Object} urls - The URLs object containing avatar URLs.
 * @returns {Object} - An object containing the status and optional data or error.
 */
async function installOnMessageHeader(window, urls) {
  const { document } = window;
  const entries = Object.entries(urls || {});
  const [mailIdentifier, urlOrObj] = entries[0] || [null, null];
  const normalizedPayload = normalizeAvatarPayload(urlOrObj, mailIdentifier);
  const url = normalizedPayload.value;
  const initialsColor = normalizedPayload.color;
  const identifier = normalizedPayload.identifier || mailIdentifier || null;
  const payloadType = determinePayloadType(url);

  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  const recipientAvatars = document.querySelectorAll(".recipient-avatar");
  let result = { status: "failed", error: "No URL found" };

  for (const recipientAvatar of recipientAvatars) {
    const hasAvatarClass = recipientAvatar.classList.contains("has-avatar");
    const isExtensionAvatar = Boolean(
      recipientAvatar.dataset.autoProfilePictureIdentifier,
    );
    if (hasAvatarClass && !isExtensionAvatar) {
      result = { status: "success" };
      continue;
    }

    if (
      shouldSkipAvatarUpdate(recipientAvatar, {
        identifier,
        type: payloadType,
        value: url,
        color: initialsColor,
        isTemporary: payloadType === "initials",
      })
    ) {
      result = { status: "success" };
      continue;
    }

    if (payloadType === "empty") {
      result = { status: "failed", error: "No URL found" };
      continue;
    }

    if (payloadType === "initials") {
      removeAvatarElements(recipientAvatar);

      let contactInitials = recipientAvatar.querySelector(
        "span.contactInitials",
      );
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      const initials = extractInitials(url);
      if (contactInitials.textContent !== initials) {
        contactInitials.textContent = initials;
      }
      recipientAvatar.classList.remove("has-avatar");
      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      recipientAvatar.appendChild(contactInitials);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      result = { status: "success" };
      continue;
    }

    removeAvatarElements(recipientAvatar);

    if (useCanvas) {
      const size = 34;
      const canvas = createAvatarCanvas(document, size);
      recipientAvatar.appendChild(canvas);
      await drawDataUrlToCanvas(url, canvas, size, size, window);
    } else {
      const img = createAvatarImage(document, url, {
        xmlns: "http://www.w3.org/1999/xhtml",
        "data-l10n-id": "message-header-recipient-avatar",
      });
      recipientAvatar.appendChild(img);
      recipientAvatar.style.background = null;
    }

    recipientAvatar.classList.add("has-avatar");
    rememberAvatarMetadata(recipientAvatar, {
      identifier,
      type: "image",
      value: url,
    });
    result = { status: "success" };
  }

  if (recipientAvatars.length > 0) {
    return result;
  }

  const popupContainer = document.getElementById("popup-container");
  if (popupContainer) {
    const dataMails = await extractMailsThunderbirdConversation(window, urls);
    return {
      status: "needData",
      data: dataMails,
    };
  }

  return {
    status: "failed",
  };
}

/**
 * Installs CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
/**
 * Avatar appearance, mirrored from settings by setAvatarStyle. Held at module
 * scope so every window picks up the current value when its CSS is installed,
 * including windows opened after the setting was changed.
 */
const avatarStyleState = {
  radius: "50%",
};

/**
 * Writes the current appearance onto a window's root element.
 * @param {Object} window - The content window.
 */
function applyAvatarStyle(window) {
  try {
    window.document.documentElement.style.setProperty(
      "--recipient-avatar-radius",
      avatarStyleState.radius,
    );
  } catch (_e) {
    // A window being torn down; nothing to style.
  }
}

function installCss(window) {
  const { document } = window;
  const avatarCss = `
  :root {
    --recipient-avatar-size: 34px;
  }
  .recipient-avatar {
    height: var(--recipient-avatar-size);
    width: var(--recipient-avatar-size);
    min-height: var(--recipient-avatar-size);
    min-width: var(--recipient-avatar-size);
    flex-shrink: 0;
    border-radius: var(--recipient-avatar-radius, 50%);
    text-align: center;
    overflow: hidden;
    align-items: center;
    justify-content: center;
    display:inline-flex;
    vertical-align: middle;
    margin-inline-end: 1px;
    color: light-dark(#71717a, #a1a1aa);
    margin-top: 1px;
  }
  .recipient-avatar.no-avatar {
    background-color: light-dark(#d4d4d8, #52525b);
  }
  .recipient-avatar {
    & img,
    & svg,
    & canvas {
      width: 100%;
      height: 100%;
    }
    & img {
      object-fit: cover;
    }
    & svg {
      display: block;
    }
    & .autoprofilepicture-item {
      width: 100%;
      height: 100%;
    }
  }
  .card-layout {
    --placeholder-margin: 4px;
  }
  /* Compact layout */
  .card-layout[style="height: 60px;"] {
    --placeholder-margin: 1px;
  }
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar),
  .card-layout .card-container:has(.recipient-avatar) {
    grid-template-columns: auto auto 1fr !important;
  }
  /* The read-status column is matched by its indicator image as well as its
     class: Thunderbird 155 added the class, but the column is the same one
     before it. */
  .card-layout .card-container:has(.recipient-avatar) > :is(.read-status-column, .thread-card-column:has(> .read-status)) {
    grid-column: 1;
    grid-row: 1;
  }
  .card-layout .recipient-avatar {
    grid-column: 2;
    grid-row: 1;
    margin-inline-end: var(--placeholder-margin);
  }
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  #threadTree[rows="thread-card"] .card-container:has(.recipient-avatar) > .thread-card-column:has(.thread-card-row),
  .card-layout .card-container:has(.recipient-avatar) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  .card-layout .card-container:has(.recipient-avatar) > .thread-card-column:has(.thread-card-row) {
    grid-column: 3;
    grid-row: 1;
  }
  .card-container:not(:has(.recipient-avatar)) > .thread-card-column:not(.read-status-column, :has(> .read-status)),
  .card-container:not(:has(.recipient-avatar)) > .thread-card-column:has(.thread-card-row) {
    margin-inline-start: calc(var(--recipient-avatar-size) + var(--placeholder-margin));
  }
  .table-layout {
    --recipient-avatar-size: 15px;
    --top-position: calc(50% - 7.5px);
  }
  .table-layout[style="height: 30px;"] {
    --recipient-avatar-size: 20px;
    --top-position: calc(50% - 10px);
  }
  .correspondentcol-column .recipient-avatar {
    position: absolute;
    left: 4.5px;
    top: var(--top-position);
  }
  /* === EMBEDDED MODERN CARDS CSS === */
/* ==========================================================================
   Thunderbird Modern Flat Cards View
   - Flat, borderless cards with subtle hover/selection
   - 2-line message body preview below subject
   - Larger Date Group headers with bottom border, left chevron,
     and right-aligned Unread/Total message counters on the same line
   ========================================================================== */

:root {
  /* Seamless flat background across the message list pane */
  --tree-pane-background: light-dark(#ffffff, #1e1e1e) !important;
  --tree-view-bg: light-dark(#ffffff, #1e1e1e) !important;

  /* Remove default card box fill and borders */
  --tree-card-background: transparent !important;
  --tree-card-border: transparent !important;
  --tree-card-border-hover: transparent !important;
  --tree-card-border-focus: transparent !important;
  --tree-card-border-selected: transparent !important;
  --tree-card-border-selected-unfocused: transparent !important;
  --tree-focus-outline: transparent !important;

  /* Remove spacing and rounded box corners between rows */
  --card-container-padding-block: 0px !important;
  --listbox-border-radius: 0px !important;

  /* Subtle flat row hover & selection highlights (matching screenshot) */
  --tree-card-background-current: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.045)) !important;
  --tree-card-background-selected: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.09)) !important;
  --tree-card-background-selected-current: light-dark(rgba(0, 0, 0, 0.09), rgba(255, 255, 255, 0.10)) !important;
  --tree-card-background-current-unfocused: light-dark(rgba(0, 0, 0, 0.03), rgba(255, 255, 255, 0.035)) !important;
  --tree-card-background-selected-unfocused: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.075)) !important;
  --tree-card-background-selected-current-unfocused: light-dark(rgba(0, 0, 0, 0.07), rgba(255, 255, 255, 0.085)) !important;
  --tree-card-background-selected-current-unfocused-hover: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.095)) !important;

  /* Avatar size for Auto Profile Picture add-on */
  --recipient-avatar-size: 38px !important;
}

/* Remove outer padding around table cells in Cards View so rows are flush */
#threadTree[rows="thread-card"] {
  padding-block: 0 !important;
  background-color: var(--tree-pane-background) !important;
}

[is="tree-view-table-body"] > .card-layout > td,
#threadTree[rows="thread-card"] .card-layout > td {
  padding: 0 !important;
}

/* Flat, borderless card container */
[is="tree-view-table-body"] > .card-layout > td > .card-container,
#threadTree[rows="thread-card"] .card-layout > td > .card-container {
  background-color: var(--tree-card-background) !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: none !important;
  padding-inline: 8px 12px !important;
  padding-block: 5px !important;
  align-items: center !important;
}

/* Hover state on unselected cards */
[is="tree-view-table-body"] > .card-layout:hover:not(.selected) > td > .card-container {
  background-color: light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.045)) !important;
}

/* Selected card state (focused and unfocused) */
[is="tree-view-table-body"] > .card-layout.selected > td > .card-container {
  background-color: light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.095)) !important;
}

/* Avatar spacing and vertical alignment (Auto Profile Picture extension) */
#threadTree[rows="thread-card"] .card-layout .recipient-avatar {
  align-self: center !important;
  margin-inline-start: 2px !important;
  margin-inline-end: 10px !important;
  margin-block: 0 !important;
}

/* Read/Unread Status Indicator:
   - Always visible on regular message cards so avatars align vertically
   - Unread: Solid bright blue dot (8px diameter)
   - Read: Subtle hollow outline circle (6px diameter, 1.2px stroke)
   - Hidden completely on Date Group header rows */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .read-status-column {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  inline-size: 14px !important;
  min-inline-size: 14px !important;
  max-inline-size: 14px !important;
  margin-inline: 0 4px !important;
  padding: 0 !important;
}

#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .read-status {
  display: inline-block !important;
  --read-status-display: inline-block !important;
  inline-size: 8px !important;
  block-size: 8px !important;
  min-inline-size: 8px !important;
  min-block-size: 8px !important;
  vertical-align: middle !important;
}

/* Unread: Solid bright blue dot (#3b82f6) */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"])[data-properties~="unread"] .read-status {
  --read-status-icon: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="4" fill="%233b82f6"/></svg>') !important;
  content: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="4" fill="%233b82f6"/></svg>') !important;
}

/* Read (Dark theme): Subtle hollow outline circle (#52525b) */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]):not([data-properties~="unread"]) .read-status {
  --read-status-icon: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="3" fill="none" stroke="%2352525b" stroke-width="1.2"/></svg>') !important;
  content: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="3" fill="none" stroke="%2352525b" stroke-width="1.2"/></svg>') !important;
}

/* Read (Light theme): Subtle hollow outline circle (#a1a1aa) */
@media (prefers-color-scheme: light) {
  #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]):not([data-properties~="unread"]) .read-status {
    --read-status-icon: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="3" fill="none" stroke="%23a1a1aa" stroke-width="1.2"/></svg>') !important;
    content: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><circle cx="4" cy="4" r="3" fill="none" stroke="%23a1a1aa" stroke-width="1.2"/></svg>') !important;
  }
}

/* Account indicator bar in Cards View (Unified Folders) */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .account-indicator {
  box-sizing: border-box !important;
  border-radius: 2px !important;
  inline-size: 3.5px !important;
  min-inline-size: 3.5px !important;
  max-inline-size: 3.5px !important;
  block-size: 13px !important;
  margin-inline-start: 0 !important;
  margin-inline-end: 6px !important;
  align-self: center !important;
  background-color: var(--account-color) !important;
}

/* Normal message card layout: Sender+Date row on top, Subject + 2-line Preview below */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container > .thread-card-column:not(.read-status-column) {
  gap: 2px !important;
  padding-block: 1px !important;
  justify-content: center !important;
}

#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row {
  display: grid !important;
  grid-template:
    "button subject info" auto
    / auto 1fr auto !important;
  align-items: start !important;
  gap: 4px !important;
}

#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .thread-card-subject-container {
  display: flex !important;
  flex-direction: column !important;
  gap: 2px !important;
  padding-inline-start: 0 !important;
  overflow: hidden !important;
  min-width: 0 !important;
}

/* Sender, Date, Subject, and 1-Line Body Preview typography (+1px) */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .sender {
  font-size: calc(1.0rem + 1px) !important;
  font-weight: 600 !important;
  color: light-dark(#18181b, #f4f4f5) !important;
  padding-inline-start: 0 !important;
}

#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .date {
  font-size: calc(0.86rem + 1px) !important;
  color: light-dark(#71717a, #a1a1aa) !important;
  opacity: 0.9 !important;
}

#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .subject {
  font-size: calc(0.95rem + 1px) !important;
  line-height: 1.3 !important;
  color: light-dark(#27272a, #e4e4e7) !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  flex: 0 0 auto !important;
}

/* 1-line message body preview snippet with larger font size (+1px) */
#threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .thread-card-preview {
  display: block !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  font-size: calc(0.92rem + 1px) !important;
  line-height: 1.35 !important;
  color: light-dark(#71717a, #9ca3af) !important;
  font-weight: 400 !important;
}

/* Unread messages: brighter/bolder sender & subject */
#threadTree[rows="thread-card"] .card-layout[data-properties~="unread"] .sender,
#threadTree[rows="thread-card"] .card-layout[data-properties~="unread"] .subject {
  font-weight: 700 !important;
  color: light-dark(#09090b, #ffffff) !important;
}

/* ==========================================================================
   Grouped-by-Date Section Headers
   ("Today", "Yesterday", "Wednesday"..."Monday", "Last Week", "Two Weeks Ago", "Older")
   ========================================================================== */
[is="tree-view-table-body"] > .card-layout[data-properties~="dummy"] > td > .card-container,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] > td > .card-container {
  background-color: transparent !important;
  border-top: none !important;
  border-left: none !important;
  border-right: none !important;
  border-bottom: 1px solid light-dark(#d4d4d8, #3a3a3f) !important;
  padding-inline: 8px 14px !important;
  padding-top: 0 !important;
  padding-bottom: 7px !important;
  align-items: flex-end !important;
}

/* Hide normal card elements on Date Group header rows */
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .read-status-column,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .read-status,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .thread-card-column:first-of-type,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .thread-card-row:first-of-type,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .thread-card-icon-info,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .thread-card-preview,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .recipient-avatar,
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .account-indicator {
  display: none !important;
}

#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .card-container > .thread-card-column {
  margin-inline-start: 0 !important;
  padding-block: 0 !important;
  justify-content: flex-end !important;
  block-size: 100% !important;
  inline-size: 100% !important;
}

/* Single horizontal row: [v] [Yesterday (Large)] .......... [Unread / Total] */
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .card-container .thread-card-dynamic-row {
  display: flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: flex-start !important;
  inline-size: 100% !important;
  gap: 8px !important;
}

#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] button.twisty {
  order: 1 !important;
  flex: 0 0 auto !important;
}

#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .thread-card-subject-container {
  order: 2 !important;
  flex: 1 1 auto !important;
  padding-inline-start: 0 !important;
  overflow: hidden !important;
}

/* Larger Date Group Header title ("Yesterday", "Wednesday", "Last Week", etc.) (+1px) */
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .subject {
  font-size: calc(1.08rem + 1px) !important;
  font-weight: 700 !important;
  line-height: 1.25 !important;
  color: light-dark(#18181b, #e4e4e7) !important;
}

/* Right-aligned Unread / Total Messages counter on the same line (+1px) */
#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .sort-header-details {
  display: inline-block !important;
  order: 3 !important;
  flex: 0 0 auto !important;
  margin-inline-start: auto !important;
  font-size: calc(0.88rem + 1px) !important;
  font-weight: 500 !important;
  color: light-dark(#71717a, #a1a1aa) !important;
  white-space: nowrap !important;
}

#threadTree[rows="thread-card"] .card-layout[data-properties~="dummy"] .sort-header-details > span {
  font-weight: 700 !important;
  color: light-dark(#18181b, #f4f4f5) !important;
}

  `;
  // Applied on every call: the shape is a custom property on the root
  // element, set from the current setting, not part of the stylesheet text.
  applyAvatarStyle(window);
  const existingStyle = document.getElementById("auto-profile-picture-style");
  if (existingStyle) {
    existingStyle.textContent = avatarCss;
    return;
  }
  const style = document.createElement("style");

  style.textContent = avatarCss;
  style.id = "auto-profile-picture-style";
  document.head.appendChild(style);
}

/**
 * Uninstalls CSS styles for avatars.
 *
 * @param {Object} window - The window object.
 */
function uninstallCss(window) {
  const { document } = window;
  const style = document.getElementById("auto-profile-picture-style");
  if (style) {
    style.remove();
  }
}

/**
 * Installs an avatar or initials on a given row element of the inbox list.
 *
 * @param {Document} document - The document object.
 * @param {string|Object} urlOrObj - The URL of the avatar image or an object with value and color for initials.
 * @param {HTMLElement} row - The row element where the avatar or initials will be installed.
 * @param {boolean} temporary - A flag indicating whether the avatar is temporary.
 * @returns {Promise<boolean>} - Returns true if the avatar or initials were successfully installed, otherwise false.
 */
async function installOnRow(document, urlOrObj, row, temporary) {
  const tbVersion = getThunderbirdVersion();
  const useCanvas = tbVersion === 145;

  let recipientAvatar = getExtensionRecipientAvatar(row);
  const isNewAvatarElement = !recipientAvatar;
  if (isNewAvatarElement) {
    recipientAvatar = document.createElement("div");
    recipientAvatar.classList.add("recipient-avatar");
    ensureAvatarOwnership(recipientAvatar);
    cacheRecipientAvatar(row, recipientAvatar);
  } else {
    ensureAvatarOwnership(recipientAvatar);
  }
  cleanupDuplicateRecipientAvatars(row, recipientAvatar);

  const normalizedPayload = normalizeAvatarPayload(urlOrObj);
  const url = normalizedPayload.value;
  const initialsColor = normalizedPayload.color;
  const identifier = normalizedPayload.identifier || null;
  const payloadType = determinePayloadType(url);
  let didUpdate = false;

  if (
    shouldSkipAvatarUpdate(recipientAvatar, {
      identifier,
      type: payloadType,
      value: url,
      color: initialsColor,
      isTemporary: temporary && payloadType === "initials",
    })
  ) {
    return false;
  }

  if (payloadType === "empty") {
    return false;
  }

  if (useCanvas) {
    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (payloadType === "image") {
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");

      removeAvatarElements(recipientAvatar);
      const existingInitials =
        recipientAvatar.querySelector(".contactInitials");
      if (existingInitials) {
        existingInitials.remove();
      }

      recipientAvatar.style.background = null;

      const win = document.defaultView || window;
      const size =
        parseInt(win.getComputedStyle(recipientAvatar).width, 10) || 34;
      const canvas = createAvatarCanvas(document, size);
      recipientAvatar.appendChild(canvas);

      await drawDataUrlToCanvas(url, canvas, size, size, win);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "image",
        value: url,
      });
      didUpdate = true;
    }

    if (!didUpdate && payloadType === "initials") {
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      recipientAvatar.style.backgroundImage = "";
      removeAvatarElements(recipientAvatar);
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      if (!recipientAvatar.contains(contactInitials)) {
        recipientAvatar.appendChild(contactInitials);
      }

      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      contactInitials.textContent = extractInitials(url);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      didUpdate = true;
    }

    if (!didUpdate) {
      return false;
    }
  } else {
    // TB < 145 and TB 146+: Use img element approach
    let img = recipientAvatar.querySelector(`.${AVATAR_CLASS}`);
    const hasNoImg = !img;
    if (hasNoImg) {
      img = createAvatarImage(document, "", {
        xmlns: "http://www.w3.org/1999/xhtml",
      });
      recipientAvatar.appendChild(img);
    }

    let contactInitials = recipientAvatar.querySelector(".contactInitials");

    if (payloadType === "image") {
      recipientAvatar.classList.add("has-avatar");
      recipientAvatar.classList.remove("no-avatar");
      img.src = url;
      if (contactInitials) {
        recipientAvatar.removeChild(contactInitials);
        recipientAvatar.style.background = null;
      }

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "image",
        value: url,
      });
      didUpdate = true;
    }

    if (!didUpdate && payloadType === "initials") {
      recipientAvatar.classList.add("no-avatar");
      recipientAvatar.classList.remove("has-avatar");
      removeAvatarElements(recipientAvatar);
      if (!contactInitials) {
        contactInitials = document.createElement("span");
      }
      contactInitials.classList.add("contactInitials");
      contactInitials.classList.add("auto-profile-picture");
      contactInitials.dataset.autoProfilePicture = "true";
      if (!recipientAvatar.contains(contactInitials)) {
        recipientAvatar.appendChild(contactInitials);
      }

      if (initialsColor) {
        recipientAvatar.style.background = initialsColor;
      } else {
        recipientAvatar.style.background = null;
      }
      contactInitials.textContent = extractInitials(url);

      rememberAvatarMetadata(recipientAvatar, {
        identifier,
        type: "initials",
        value: url,
        color: initialsColor,
      });
      didUpdate = true;
    }

    if (!didUpdate) {
      return false;
    }
  }

  if (!didUpdate) {
    return false;
  }

  mountRecipientAvatar(row, recipientAvatar);
  return true;
}

/**
 * Uninstalls the avatars or initials.
 *
 * @param {Object} window - The window object.
 */
function uninstall(window) {
  uninstallCss(window);
}

const EVENTS_TO_LISTEN = [
  "viewchange",
  "rowcountchange",
  "collapsed",
  "expanded",
  "showplaceholder",
  "scroll",
  "change",
  "drop",
  "click",
];
const EVENTS_TABLE_TO_LISTEN = ["thread-changed", "sort-changed"];

/**
 * Initializes event listeners on the thread tree.
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {number} payloadLength - The length of the payload.
 * @param {Object} window - The window object.
 * @return {Promise} - A promise that resolves with the event type.
 */
async function initializeAllEventListeners(threadTree, payloadLength, window) {
  const eventsToListen = new Set(EVENTS_TO_LISTEN);
  if (threadTree._rows.length === payloadLength) {
    eventsToListen.delete("scroll");
  }
  const tableThreadTree = threadTree.getElementsByTagName("table")[0];

  const eventType = await Promise.race([
    setupEventListeners(tableThreadTree, EVENTS_TABLE_TO_LISTEN, window),
    setupEventListeners(threadTree, eventsToListen, window),
  ]);
  return eventType;
}

/**
 * Sets up event listeners on the thread tree.
 *
 * @param {Object} threadTree - The thread tree object.
 * @param {Set} eventsToListen - The set of events to listen for.
 * @param {Object} window - The window object.
 * @returns {Promise} - A promise that resolves with the event type.
 */
function setupEventListeners(threadTree, eventsToListen, window) {
  return new Promise((resolve) => {
    const handleEvent = (event) => {
      // console.log("TT resolve", event.type);
      cleanup();
      resolve(event.type);
    };

    const cleanup = () => {
      for (const event of eventsToListen) {
        threadTree.removeEventListener(event, handleEvent);
      }
      observer.disconnect();
    };

    const observer = new window.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.target.classList.contains("recipient-avatar") ||
          mutation.target.classList.contains("contactInitials") ||
          mutation.target.classList.contains("autoprofilepicture-item") ||
          mutation.target.classList.contains("thread-card-preview") ||
          mutation.target.classList.contains("subject")
        ) {
          // mutations caused by the extension
          continue;
        }
        if (
          mutation.type === "childList" &&
          (mutation.removedNodes.length > 0 || mutation.addedNodes.length > 0)
        ) {
          let isAvatarChange = false;
          const nodesToCheck =
            mutation.removedNodes.length > 0
              ? mutation.removedNodes
              : mutation.addedNodes;
          for (const node of nodesToCheck) {
            if (
              node.classList &&
              (node.classList.contains("recipient-avatar") ||
                node.classList.contains("contactInitials") ||
                node.classList.contains("thread-card-preview"))
            ) {
              isAvatarChange = true;
              break;
            }
          }
          if (isAvatarChange) continue;

          cleanup();
          window.setTimeout(() => {
            resolve("childList");
          }, 300); // WAIT_TIME_MS - 200
          break;
        }
      }
    });
    observer.observe(threadTree, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    for (const event of eventsToListen) {
      threadTree.removeEventListener(event, handleEvent);
      threadTree.addEventListener(event, handleEvent, { once: true });
    }
  });
}

const MSG_VIEW_FLAG_DUMMY = 0x20000000;

/**
 * Returns the per-window main-process cache mapping a message key to its
 * already-resolved avatar payload. This lets us repaint recycled rows (e.g.
 * when scrolling back up) instantly, with no round-trip to the background.
 * @param {Object} window - The content window.
 * @returns {Map<number, Object>}
 */
function getAvatarPaintCache(window) {
  if (!window.__apAvatarPaintCache) {
    window.__apAvatarPaintCache = new Map();
  }
  return window.__apAvatarPaintCache;
}

/**
 * Normalizes a threadTree._rows key to a numeric row index.
 * @param {number|string} key
 * @returns {number}
 */
function toRowIndex(key) {
  return typeof key === "number" ? key : parseInt(key, 10);
}

/**
 * Builds a stable cache key for a message header. messageKey is only unique
 * within a folder, so the folder URI is included to avoid cross-folder
 * collisions.
 * @param {Object} hdr - nsIMsgDBHdr
 * @returns {string}
 */
function msgCacheKey(hdr) {
  const folderUri = hdr.folder?.URI || "";
  return `${folderUri}:${hdr.messageKey}`;
}

/**
 * Lists the rows currently rendered in the thread tree that show a message,
 * skipping grouped-by-sort header rows and any row that cannot be resolved.
 * @param {Object} threadTree - The thread tree element.
 * @returns {Array<{index: number, row: Object, hdr: Object, msgKey: string}>}
 */
function getRenderedMessageRows(threadTree) {
  if (!threadTree || !threadTree._view || !threadTree._rows) {
    return [];
  }
  const view = threadTree._view;
  const result = [];
  for (const [key, row] of threadTree._rows) {
    const index = toRowIndex(key);
    if (!Number.isInteger(index) || !row) {
      continue;
    }
    try {
      if (view.getFlagsAt && view.getFlagsAt(index) & MSG_VIEW_FLAG_DUMMY) {
        continue;
      }
      const hdr = view.getMsgHdrAt ? view.getMsgHdrAt(index) : null;
      if (hdr) {
        result.push({ index, row, hdr, msgKey: msgCacheKey(hdr) });
      }
    } catch (_e) {
      // Skip any row we can't resolve.
    }
  }
  return result;
}

/**
 * Repaints every currently-rendered row from the main-process paint cache.
 * Synchronous and cheap (bounded to visible rows); rows whose avatar is
 * unchanged are skipped by installOnRow, so this never flickers. Rows with no
 * cache entry yet (never-seen senders) are left for the background to resolve.
 * @param {Object} window - The content window.
 */
function repaintVisibleFromCache(window) {
  try { installModernCardsEnhancements(window); } catch (_e) {}
  const cache = getAvatarPaintCache(window);
  if (cache.size === 0) {
    return;
  }
  for (const { row, msgKey } of getRenderedMessageRows(window?.threadTree)) {
    const cached = cache.get(msgKey);
    if (cached) {
      installOnRow(window.document, cached, row, false);
    }
  }
}

/**
 * Whether a rendered row shows a message that no pass has resolved yet.
 *
 * The background reads the visible rows, spends however long the lookups
 * take, then paints and waits for the next view change. Thunderbird keeps
 * rendering in the meantime: it grows the row buffer after a folder opens and
 * scrolls to the selected message. Those changes fire before the listener is
 * armed, so without this check their rows stay blank until some unrelated
 * event comes along.
 *
 * @param {Object} window - The content window.
 * @param {Set<string>} attemptedKeys - Messages the last pass resolved.
 * @returns {boolean}
 */
function hasUnresolvedRows(window, attemptedKeys) {
  const cache = getAvatarPaintCache(window);
  return getRenderedMessageRows(window?.threadTree).some(
    ({ msgKey }) => !cache.has(msgKey) && !attemptedKeys.has(msgKey),
  );
}

/**
 * Installs a single persistent scroll + mutation listener per window that
 * repaints visible rows from the paint cache (rAF-debounced). This is the
 * gap-free path that keeps avatars painted while scrolling — especially when
 * scrolling back up into rows Thunderbird recycled and blanked.
 * @param {Object} window - The content window.
 */

// === MODERN CARDS ENHANCEMENTS (2-Line Body Preview + Detailed Date Groups + Instant Avatars) ===
const WEEKDAY_NAMES_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getSmartDateGroupKey(msgHdr) {
  try {
    if (!msgHdr) {
      return "10|Older";
    }
    const msgTimeMs = Math.floor((msgHdr.date || 0) / 1000);
    if (!msgTimeMs || msgTimeMs <= 0) {
      return "10|Older";
    }
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const yesterdayStart = todayStart - 86400000;

    // Start of current week (Monday 00:00:00)
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const thisWeekStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - daysSinceMonday
    ).getTime();
    const lastWeekStart = thisWeekStart - 7 * 86400000;
    const twoWeeksAgoStart = thisWeekStart - 14 * 86400000;

    const msgDate = new Date(msgTimeMs);
    const msgDayStart = new Date(
      msgDate.getFullYear(),
      msgDate.getMonth(),
      msgDate.getDate()
    ).getTime();

    if (msgDayStart >= todayStart) {
      return "99|Today";
    }
    if (msgDayStart >= yesterdayStart) {
      return "98|Yesterday";
    }
    if (msgDayStart >= thisWeekStart) {
      const daysAgo = Math.max(
        2,
        Math.min(6, Math.round((todayStart - msgDayStart) / 86400000))
      );
      const bucket = 99 - daysAgo; // 97 down to 93
      const dayName = WEEKDAY_NAMES_EN[msgDate.getDay()];
      return `${bucket}|${dayName}`;
    }
    if (msgDayStart >= lastWeekStart) {
      return "80|Last Week";
    }
    if (msgDayStart >= twoWeeksAgoStart) {
      return "70|Two Weeks Ago";
    }
    return "10|Older";
  } catch (_e) {
    return "10|Older";
  }
}

function cleanEmailBodyToSnippet(raw) {
  if (!raw || typeof raw !== "string") {
    return "";
  }
  let text = raw;
  text = text
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!DOCTYPE[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>]*$/g, " ");
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&zwnj;|&zwj;|&shy;/gi, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    });
  text = text.replace(
    /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u034F\u115F\u1160\u17B4\u17B5\u3164\uFFA0]+/g,
    " "
  );
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 260) {
    text = text.slice(0, 260).trim();
  }
  return text;
}

function getMessagePreviewSnippet(window, hdr) {
  if (!hdr) {
    return "";
  }
  if (!window.__apSnippetCache) {
    window.__apSnippetCache = new Map();
  }
  const cache = window.__apSnippetCache;
  if (cache.size > 5000) {
    cache.clear();
  }
  const key = msgCacheKey(hdr);
  if (cache.has(key)) {
    return cache.get(key);
  }
  let snippet = "";
  try {
    const saved = hdr.getStringProperty("previewCleanV1");
    if (saved) {
      cache.set(key, saved);
      return saved;
    }
  } catch (_e) {}

  try {
    const folder = hdr.folder;
    if (folder && typeof folder.getMsgInputStream === "function") {
      const reusable = {};
      const stream = folder.getMsgInputStream(hdr, reusable);
      if (stream) {
        try {
          const contentType = {};
          const raw = folder.getMsgTextFromStream(
            stream,
            hdr.charset || "UTF-8",
            65536,
            32768,
            true,
            false,
            contentType
          );
          snippet = cleanEmailBodyToSnippet(raw);
        } finally {
          if (!reusable.value) {
            try {
              stream.close();
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}

  if (!snippet) {
    try {
      const fallback = hdr.getStringProperty("preview");
      if (fallback) {
        snippet = cleanEmailBodyToSnippet(fallback);
      }
    } catch (_e) {}
  }

  cache.set(key, snippet);
  if (snippet) {
    try {
      hdr.setStringProperty("previewCleanV1", snippet);
    } catch (_e) {}
  }
  return snippet;
}

function computeInstantFallbackInitials(hdr) {
  const raw = (hdr?.mime2DecodedAuthor || hdr?.author || "").trim();
  if (!raw) {
    return { value: "//INITIAL:?", color: null, identifier: "__temp__" };
  }
  let email = "";
  const emailMatch = raw.match(/<([^>]+)>/);
  if (emailMatch) {
    email = emailMatch[1].trim().toLowerCase();
  } else if (raw.includes("@")) {
    email = raw.trim().toLowerCase();
  }
  let display = raw.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();
  if (!display) {
    display = email.split("@")[0] || "?";
  }
  const parts = display
    .split(/[\s._-]+/)
    .map(s => s.trim())
    .filter(Boolean);
  let initials = "";
  if (parts.length >= 2) {
    initials = (parts[0][0] || "") + (parts[parts.length - 1][0] || "");
  } else if (parts.length === 1) {
    initials = parts[0].slice(0, 2);
  } else {
    initials = "?";
  }
  initials = initials.toUpperCase();
  const idForHash = email || display.toLowerCase();
  let hash = 0;
  for (let i = 0; i < idForHash.length; i++) {
    hash = (hash << 5) - hash + idForHash.charCodeAt(i);
    hash |= 0;
  }
  const hue = (Math.abs(hash) % 36000) / 100;
  const lightnessLight = 0.8 + (Math.abs(hash) % 10) / 100;
  const chromaLight = 0.05 + (Math.abs(hash) % 5) / 1000;
  const lightnessDark = 0.4 + (Math.abs(hash) % 10) / 100;
  const chromaDark = 0.05 + (Math.abs(hash) % 5) / 1000;
  const color = `light-dark(oklch(${lightnessLight.toFixed(2)} ${chromaLight.toFixed(3)} ${hue.toFixed(2)}), oklch(${lightnessDark.toFixed(2)} ${chromaDark.toFixed(3)} ${hue.toFixed(2)}))`;
  return {
    value: `//INITIAL:${initials}`,
    color,
    identifier: "__temp__",
  };
}

function decorateSingleCardRow(window, row) {
  if (!row || !row.classList?.contains("card-layout")) {
    return;
  }
  const isDummy = (row.dataset?.properties || "").split(" ").includes("dummy");
  if (isDummy) {
    const subj = row.querySelector(".subject");
    if (subj && subj.textContent) {
      let clean = subj.textContent.replace(/^\d+\|/, "");
      if (clean === "Last 7 Days") clean = "Last Week";
      if (clean === "Last 14 Days") clean = "Two Weeks Ago";
      if (subj.textContent !== clean) {
        subj.textContent = clean;
        subj.title = clean;
      }
    }
    const prev = row.querySelector(".thread-card-preview");
    if (prev) {
      prev.textContent = "";
    }
    return;
  }

  installCss(window);

  const subjContainer = row.querySelector(".thread-card-subject-container");
  if (!subjContainer) {
    return;
  }
  let previewEl = subjContainer.querySelector(".thread-card-preview");
  if (!previewEl) {
    previewEl = window.document.createElement("div");
    previewEl.className = "thread-card-preview";
    subjContainer.appendChild(previewEl);
  }
  const view = row.view || window.threadTree?._view || window.gDBView;
  const index = typeof row._index === "number" ? row._index : row.index;
  if (view && Number.isInteger(index) && index >= 0) {
    try {
      const hdr = view.getMsgHdrAt(index);
      if (hdr) {
        const snippet = getMessagePreviewSnippet(window, hdr);
        if (previewEl.textContent !== snippet) {
          previewEl.textContent = snippet;
          previewEl.title = snippet;
        }
        const msgKey = msgCacheKey(hdr);
        const cache = getAvatarPaintCache(window);
        const cachedAvatar = cache.get(msgKey);
        if (cachedAvatar) {
          installOnRow(window.document, cachedAvatar, row, false);
        } else if (!getExtensionRecipientAvatar(row)) {
          const fallback = computeInstantFallbackInitials(hdr);
          installOnRow(window.document, fallback, row, true);
        }
      }
    } catch (_e) {}
  }
}

function installModernCardsEnhancements(window) {
  if (!window || !window.document) {
    return;
  }
  try {
    const { ThreadPaneColumns } = ChromeUtils.importESModule(
      "chrome://messenger/content/ThreadPaneColumns.mjs"
    );
    const { DBViewWrapper } = ChromeUtils.importESModule(
      "resource:///modules/DBViewWrapper.sys.mjs"
    );

    if (
      !ThreadPaneColumns.getCustomColumns().some(c => c.id === "smartDateCol")
    ) {
      ThreadPaneColumns.addCustomColumn("smartDateCol", {
        name: "Date",
        hidden: true,
        sortable: true,
        textCallback: getSmartDateGroupKey,
      });
    }

    if (!DBViewWrapper.prototype.__smartDateCreateViewHooked) {
      const origCreateView = DBViewWrapper.prototype._createView;
      DBViewWrapper.prototype._createView = function () {
        let useSmartDate = false;
        try {
          const primaryType = this._sort?.[0]?.[0];
          if (
            this.showGroupedBySort ||
            primaryType === Ci.nsMsgViewSortType.byDate ||
            primaryType === Ci.nsMsgViewSortType.byCustom
          ) {
            useSmartDate = true;
            const groupFlags =
              Ci.nsMsgViewFlagsType.kGroupBySort |
              Ci.nsMsgViewFlagsType.kThreadedDisplay |
              Ci.nsMsgViewFlagsType.kExpandAll;
            this._viewFlags |= groupFlags;
            if (this.__viewFlags != null) {
              this.__viewFlags |= groupFlags;
            } else {
              this.__viewFlags =
                Services.prefs.getIntPref("mailnews.default_view_flags", 97) |
                groupFlags;
            }
            this._threadExpandAll = true;
            // Always pass byDate into C++ dbView.open() so it succeeds before addColumnHandler runs
            this._sort[0] = [
              Ci.nsMsgViewSortType.byDate,
              Ci.nsMsgViewSortOrder.descending,
            ];
          }
        } catch (e) {
          console.warn("smartDateCol pre-hook error:", e);
        }

        const dbView = origCreateView.apply(this, arguments);

        try {
          if (dbView && useSmartDate) {
            const col = ThreadPaneColumns.getColumn("smartDateCol");
            if (col?.handler) {
              const origAddCol = dbView.addColumnHandler.bind(dbView);
              origAddCol("smartDateCol", col.handler);
              // Prevent subsequent duplicate addColumnHandler("smartDateCol") calls (e.g. in onCreatedView)
              // from triggering nsMsgGroupView::RebuildView() on populated views.
              dbView.addColumnHandler = function (colId, handler) {
                if (colId === "smartDateCol") {
                  return;
                }
                return origAddCol(colId, handler);
              };
              dbView.curCustomColumn = "smartDateCol";
              // Safe for BOTH single folders (m_db enumerator) and multi-folder/search views
              // because associateView() has not been called yet so rowCountBeforeSort === 0!
              dbView.sort(
                Ci.nsMsgViewSortType.byCustom,
                Ci.nsMsgViewSortOrder.descending
              );
              if (
                this.isSingleFolder &&
                !this.isVirtual &&
                !this.search?.hasSearchTerms &&
                !(dbView.viewFlags & Ci.nsMsgViewFlagsType.kExpandAll)
              ) {
                dbView.doCommand(Ci.nsMsgViewCommandType.expandAll);
              }
              this._sort = [
                [
                  Ci.nsMsgViewSortType.byCustom,
                  Ci.nsMsgViewSortOrder.descending,
                  "smartDateCol",
                ],
              ];
              dbView.__smartDateCreated = true;
            }
          }
        } catch (e) {
          console.warn("smartDateCol post-hook error:", e);
        }
        return dbView;
      };
      DBViewWrapper.prototype.__smartDateCreateViewHooked = true;
    }
  } catch (e) {
    console.warn("Error setting up smartDateCol:", e);
  }

  // Hook ThreadCard.prototype.fillRow for instant zero-flicker rendering
  try {
    const ThreadCard = window.customElements?.get("thread-card");
    if (ThreadCard && !ThreadCard.prototype.__modernPreviewHooked) {
      const origFillRow = ThreadCard.prototype.fillRow;
      ThreadCard.prototype.fillRow = function () {
        const res = origFillRow.apply(this, arguments);
        try {
          decorateSingleCardRow(window, this);
        } catch (_e) {}
        return res;
      };
      ThreadCard.prototype.__modernPreviewHooked = true;
    }
  } catch (_e) {}

  // Hook dbViewWrapperListener.onMessagesLoaded to ensure all date groups expand once search completes
  try {
    const listener = window.dbViewWrapperListener;
    if (listener && !listener.__modernExpandHooked) {
      const origOnLoaded = listener.onMessagesLoaded;
      if (typeof origOnLoaded === "function") {
        listener.onMessagesLoaded = function (all) {
          try {
            if (window.gViewWrapper?.showGroupedBySort) {
              window.gViewWrapper._threadExpandAll = true;
            }
          } catch (_e) {}
          const res = origOnLoaded.apply(this, arguments);
          try {
            if (
              all &&
              window.gViewWrapper?.showGroupedBySort &&
              window.gDBView &&
              !(window.gDBView.viewFlags & Ci.nsMsgViewFlagsType.kExpandAll)
            ) {
              window.gDBView.doCommand(Ci.nsMsgViewCommandType.expandAll);
              window.threadTree?.reset();
              window.threadTree?.invalidate();
            }
          } catch (_e) {}
          return res;
        };
      }
      listener.__modernExpandHooked = true;
    }
  } catch (_e) {}

  if (!window.__modernFolderListenerInstalled) {
    window.__modernFolderListenerInstalled = true;
    window.addEventListener("folderURIChanged", () => {
      window.setTimeout(() => {
        try {
          installModernCardsEnhancements(window);
        } catch (_e) {}
      }, 80);
    });
  }

  // If the current view was opened before our _createView hook was installed,
  // recreate it cleanly through DBViewWrapper so associateView() re-runs OnNewSearch().
  try {
    const vw = window.gViewWrapper;
    if (vw && vw.dbView && !vw.dbView.__smartDateCreated) {
      vw.dbView.__smartDateCreated = true;
      vw.beginViewUpdate();
      vw.showGroupedBySort = true;
      vw._threadExpandAll = true;
      vw.endViewUpdate();
    }
  } catch (_e) {}

  // Decorate any already-rendered rows
  try {
    if (window.threadTree?._rows) {
      for (const [, row] of window.threadTree._rows) {
        decorateSingleCardRow(window, row);
      }
    }
  } catch (_e) {}
}

function bootstrapAll3PaneWindows() {
  try {
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const tabmail = win.gTabmail || win.document?.getElementById("tabmail");
      if (!tabmail?.tabInfo) {
        continue;
      }
      for (const nativeTab of tabmail.tabInfo) {
        const contentWin = getContentWindow(nativeTab);
        const tree =
          contentWin?.threadTree ||
          contentWin?.document?.getElementById("threadTree");
        if (contentWin && tree) {
          if (!contentWin.threadTree) {
            contentWin.threadTree = tree;
          }
          installCss(contentWin);
          ensurePersistentRepaint(contentWin);
          installModernCardsEnhancements(contentWin);
        }
      }
    }
  } catch (_e) {}
}

let __modernBootstrapStarted = false;
function startModernCardsBootstrap() {
  if (__modernBootstrapStarted) {
    bootstrapAll3PaneWindows();
    return;
  }
  __modernBootstrapStarted = true;
  try {
    Services.prefs.setIntPref("mail.threadpane.cardsview.rowcount", 3);
    Services.prefs.setIntPref("extensions.startupScanScopes", 15);
    Services.prefs.setIntPref("extensions.autoDisableScopes", 0);
    Services.prefs.setBoolPref("extensions.strictCompatibility", false);
    Services.prefs.setBoolPref("extensions.checkCompatibility", false);
    Services.prefs.setBoolPref("extensions.getAddons.cache.enabled", false);
    const ver = Services.appinfo?.version || "158.0";
    const major = ver.split(".")[0];
    Services.prefs.setBoolPref(`extensions.checkCompatibility.${ver}`, false);
    Services.prefs.setBoolPref(`extensions.checkCompatibility.${major}.0`, false);
    Services.prefs.setBoolPref(`extensions.checkCompatibility.${major}.0a1`, false);
  } catch (_e) {}
  try {
    bootstrapAll3PaneWindows();
    let tries = 0;
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    timer.initWithCallback(
      {
        notify() {
          tries++;
          bootstrapAll3PaneWindows();
          if (tries >= 40) {
            timer.cancel();
          }
        },
      },
      500,
      Ci.nsITimer.TYPE_REPEATING_SLACK
    );
  } catch (_e) {}
}

function ensurePersistentRepaint(window) {
  if (window.__apPersistentRepaintInstalled) {
    return;
  }
  const threadTree = window?.threadTree;
  if (!threadTree) {
    return;
  }
  window.__apPersistentRepaintInstalled = true;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    const run = () => {
      scheduled = false;
      repaintVisibleFromCache(window);
    };
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  };

  threadTree.addEventListener("scroll", schedule, { passive: true });
  const observer = new window.MutationObserver(schedule);
  observer.observe(threadTree, { childList: true, subtree: true });
  window.__apPersistentRepaintObserver = observer;
  window.__apPersistentRepaintScroll = schedule;
}

/**
 * Undoes everything the add-on did to a message list's window.
 *
 * The repaint hook, its paint cache and the painted avatars all live on the
 * window, which outlives the add-on. Left in place, a disabled or removed
 * add-on kept repainting avatars until Thunderbird restarted, and an updated
 * one found the hook already installed, skipped its own, and was repainted
 * by the previous version's code.
 * @param {Object} window - The content window.
 */
function teardownThreadPane(window) {
  window.__apPersistentRepaintObserver?.disconnect();
  if (window.__apPersistentRepaintScroll) {
    window.threadTree?.removeEventListener(
      "scroll",
      window.__apPersistentRepaintScroll,
    );
  }
  delete window.__apPersistentRepaintObserver;
  delete window.__apPersistentRepaintScroll;
  delete window.__apPersistentRepaintInstalled;
  delete window.__apAvatarPaintCache;

  for (const avatar of window.document.querySelectorAll(
    EXTENSION_AVATAR_SELECTOR,
  )) {
    avatar.remove();
  }
  window.document.documentElement.style.removeProperty(
    "--recipient-avatar-radius",
  );
  uninstallCss(window);
}

// biome-ignore lint/correctness/noUnusedVariables: Variable name required by the extension API
var headerApi = class extends ExtensionCommon.ExtensionAPI {
  onStartup() {
    startModernCardsBootstrap();
  }
  getAPI(context) {
    startModernCardsBootstrap();

    return {
      headerApi: {
        /**
         * Installs avatars on message headers.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlJSON - The JSON string containing avatar URLs.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeaders(tabId, urlJSON) {
          const urls = JSON.parse(urlJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installOnMessageHeader(messageBrowserWindow, urls);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },
        /**
         * Installs avatars in Thunderbird conversation.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} payloadJSON - The JSON string containing payload data.
         * @returns {Object} - An object containing the status and optional data or error.
         */
        async pictureHeadersConversation(tabId, payloadJSON) {
          const payload = JSON.parse(payloadJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const messageBrowserWindow = getMessageWindow(nativeTab);
          if (messageBrowserWindow) {
            try {
              return await installConversation(messageBrowserWindow, payload);
            } catch (e) {
              console.error(e);
              return {
                status: "failed",
                error: e,
              };
            }
          }
          return {
            status: "failed",
            error: "No messageBrowser window found",
          };
        },

        /**
         * Viewport-only: returns the messages for the rows that are currently
         * rendered on screen, read directly from the message view (random
         * access, no folder pagination). Skips grouped/dummy header rows.
         *
         * @param {number} tabId - The tab ID.
         * @returns {Array<{index:number, message:Object}>}
         */
        async getVisibleRowMessages(tabId) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          if (window) {
            try {
              installCss(window);
              ensurePersistentRepaint(window);
              installModernCardsEnhancements(window);
            } catch (_e) {}
          }
          const result = [];
          for (const { index, hdr, msgKey } of getRenderedMessageRows(
            window?.threadTree,
          )) {
            let message;
            try {
              message = context.extension.messageManager.convert(hdr);
            } catch (_e) {
              message = { author: hdr.author || "", recipients: [] };
            }
            result.push({ index, key: msgKey, message });
          }
          return result;
        },

        /**
         * Viewport-only: paints avatars onto the currently rendered rows.
         *
         * Payloads are keyed by message, not by row index. The view can
         * scroll, grow or re-sort while the background resolves them, and an
         * index read before that would now point at another message's row.
         * Rows are therefore matched to their message at paint time, and a
         * message no longer on screen is only cached, for when it comes back.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} urlsJSON - JSON map of { messageKey: urlOrInitialsObj }.
         * @returns {Object} - Status object.
         */
        async paintRowAvatars(tabId, urlsJSON) {
          const urls = JSON.parse(urlsJSON);
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window?.threadTree;
          if (!threadTree || !threadTree._rows) {
            return { status: "failed" };
          }
          installCss(window);
          ensurePersistentRepaint(window);

          const cache = getAvatarPaintCache(window);
          // Keep the cache from growing without bound on very long sessions.
          if (cache.size > 4000) {
            cache.clear();
          }
          // Cached by message so a row Thunderbird recycles later can be
          // repainted without asking the background.
          for (const [msgKey, url] of Object.entries(urls)) {
            cache.set(msgKey, url);
          }

          // Every rendered row with a cached avatar is painted, not only the
          // ones in this payload. Thunderbird recreates rows while a pass is
          // running, and one painted by an earlier call would otherwise wait
          // for the next animation frame to be repainted, which a minimized
          // window never runs. Unchanged rows are skipped by installOnRow.
          for (const { row, msgKey } of getRenderedMessageRows(threadTree)) {
            const url = cache.get(msgKey);
            if (!url) {
              continue;
            }
            try {
              await installOnRow(window.document, url, row, false);
            } catch (e) {
              console.error("paintRowAvatars error", e);
            }
          }
          return { status: "success" };
        },

        /**
         * Sets the avatar appearance for this and all future windows.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} styleJSON - JSON { radius }.
         * @returns {Object} - Status object.
         */
        async setAvatarStyle(tabId, styleJSON) {
          try {
            const style = JSON.parse(styleJSON);
            if (typeof style.radius === "string") {
              avatarStyleState.radius = style.radius;
            }
          } catch (error) {
            console.error("setAvatarStyle: bad payload", error);
            return { status: "failed" };
          }
          try {
            const { nativeTab } = context.extension.tabManager.get(tabId);
            const window = getContentWindow(nativeTab);
            if (window) {
              applyAvatarStyle(window);
            }
          } catch (_e) {
            // No live window yet; the next installCss picks the value up.
          }
          return { status: "success" };
        },

        /**
         * Installs event listeners on the inbox list.
         *
         * When the messages the last pass resolved are given, it first
         * checks for rendered rows outside them, and returns "stale" at once
         * if there are any rather than waiting for an event that has already
         * passed. The check and the listeners are set up in the same task, so
         * no change can slip between them.
         *
         * @param {number} tabId - The tab ID.
         * @param {string} [attemptedKeysJSON] - JSON array of message keys.
         * @returns {Promise<string>} The event type, or "stale".
         */
        async installEventListeners(tabId, attemptedKeysJSON) {
          const { nativeTab } = context.extension.tabManager.get(tabId);
          const window = getContentWindow(nativeTab);
          const threadTree = window.threadTree;
          if (
            attemptedKeysJSON &&
            hasUnresolvedRows(window, new Set(JSON.parse(attemptedKeysJSON)))
          ) {
            return "stale";
          }
          const eventType = await initializeAllEventListeners(
            threadTree,
            0,
            window,
          );
          return eventType;
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      // Every window is closing with the application; nothing to undo.
      return;
    }
    for (const window of Services.wm.getEnumerator("mail:3pane")) {
      for (const nativeTab of window.gTabmail.tabInfo) {
        if (nativeTab.mode?.name === "mail3PaneTab") {
          try {
            teardownThreadPane(getContentWindow(nativeTab));
          } catch (e) {
            // One tab failing to clean up must not stop the others.
            console.error("Error removing inbox-list avatars:", e);
          }
        }
        const messageBrowserWindow = getMessageWindow(nativeTab);
        if (messageBrowserWindow) {
          uninstall(messageBrowserWindow);
        }
      }
    }

    for (const window of Services.wm.getEnumerator("mail:messageWindow")) {
      const messageBrowserWindow = getMessageWindow(window);
      if (messageBrowserWindow) {
        uninstall(messageBrowserWindow);
      }
    }
  }
};
