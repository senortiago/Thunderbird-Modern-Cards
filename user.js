// Enable chrome/userChrome.css custom styling
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);

// Use 3-row Cards View height to fit Sender + Subject + 1-line Message Preview
user_pref("mail.threadpane.cardsview.rowcount", 3);

// Default message list sorting: Grouped by Sort + Expand All + Threaded bit (64 | 32 | 1 = 97), Date Descending
user_pref("mailnews.default_view_flags", 97);
user_pref("mailnews.default_sort_type", 18);
user_pref("mailnews.default_sort_order", 2);

// Permanently scan profile extensions and prevent Thunderbird updates from auto-disabling add-ons
user_pref("extensions.startupScanScopes", 15);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.strictCompatibility", false);
user_pref("extensions.checkCompatibility", false);
user_pref("extensions.checkCompatibility.158.0", false);
user_pref("extensions.checkCompatibility.158.0a1", false);
user_pref("extensions.checkCompatibility.159.0", false);
user_pref("extensions.checkCompatibility.160.0", false);
user_pref("extensions.getAddons.cache.enabled", false);
