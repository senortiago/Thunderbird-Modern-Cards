"""
Account Colorizer for Thunderbird
Generates aesthetic, randomized domain-based color-coding for all accounts in a profile.
Accounts sharing the same domain receive harmonized lighter/darker variations of that domain's base color.
"""

import colorsys
import json
import os
import re
import urllib.parse

# Curated base hues for popular email providers and custom domains
KNOWN_DOMAIN_HUES = {
    "outlook.com": 214,        # Microsoft Royal Blue
    "live.com": 238,           # Cobalt / Indigo
    "hotmail.com": 195,        # Deep Ocean Cyan
    "hotmail.gr": 195,         # Deep Ocean Cyan
    "msn.com": 205,            # Classic MSN Blue
    "gmail.com": 4,            # Google Red / Coral
    "googlemail.com": 4,
    "yahoo.com": 275,          # Yahoo Purple
    "yahoo.gr": 275,           # Yahoo Purple
    "icloud.com": 200,         # Apple Sky Blue
    "me.com": 200,
    "proton.me": 260,          # Proton Violet
    "protonmail.com": 260,
    "cartconsole.com": 155,    # Emerald Green
    "sygraphe.com": 30,        # Tangerine Orange
    "wonkyrobot.eu": 315,      # Fuchsia / Magenta
    "wana.gr": 175,            # Seafoam / Teal
    "epiplobelekoukias.gr": 48, # Warm Golden Amber
    "forthnet.gr": 202,        # Azure Blue
    "sch.gr": 135,             # Jade / Spring Green
}


def get_domain_hue(domain: str) -> float:
    """Returns a deterministic base hue (0-360) for any domain."""
    d = domain.lower().strip()
    if d in KNOWN_DOMAIN_HUES:
        return KNOWN_DOMAIN_HUES[d]
    # Deterministic FNV-like hash to evenly spread custom domains across the 360-degree color wheel
    h = 2166136261
    for i, c in enumerate(d):
        h = (h ^ (ord(c) * (i + 1))) * 16777619
        h &= 0xFFFFFFFF
    return float((h * 137) % 360)


def hsl_to_hex(h: float, s: float, l: float) -> str:
    """Converts HSL (0-360, 0-100, 0-100) to hex color string."""
    h_norm = (h % 360) / 360.0
    l_norm = max(0.0, min(1.0, l / 100.0))
    s_norm = max(0.0, min(1.0, s / 100.0))
    r, g, b = colorsys.hls_to_rgb(h_norm, l_norm, s_norm)
    return f"#{int(round(r * 255)):02x}{int(round(g * 255)):02x}{int(round(b * 255)):02x}"


def extract_accounts_from_prefs(prefs_path: str):
    """Parses Thunderbird prefs.js to extract all accounts and server details."""
    prefs = {}
    if not os.path.exists(prefs_path):
        return []

    with open(prefs_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if line.startswith("user_pref("):
                m = re.match(r'user_pref\("([^"]+)",\s*(.+)\);', line)
                if m:
                    k, v = m.group(1), m.group(2)
                    if v.startswith('"') and v.endswith('"'):
                        try:
                            v = v[1:-1].encode().decode("unicode-escape")
                        except Exception:
                            v = v[1:-1]
                    prefs[k] = v

    accounts_str = prefs.get("mail.accountmanager.accounts", "")
    account_keys = [a for a in accounts_str.split(",") if a]

    discovered = []
    for acc in account_keys:
        server_key = prefs.get(f"mail.account.{acc}.server")
        if not server_key:
            continue
        server_type = prefs.get(f"mail.server.{server_key}.type", "none")
        user_name = prefs.get(f"mail.server.{server_key}.userName", "")
        host_name = prefs.get(f"mail.server.{server_key}.realHostName") or prefs.get(f"mail.server.{server_key}.hostname", "")
        pretty_name = prefs.get(f"mail.server.{server_key}.name", "")

        identities = prefs.get(f"mail.account.{acc}.identities", "").split(",")
        email = ""
        for id_key in identities:
            if id_key:
                email = prefs.get(f"mail.identity.{id_key}.useremail", "")
                if email:
                    break
        if not email and "@" in user_name:
            email = user_name

        if server_type == "none" or "nobody" in user_name.lower():
            domain = "local"
            root_uri = "mailbox://nobody@Local%20Folders"
        else:
            domain = email.split("@")[1].lower() if "@" in email else host_name.lower()
            auth = f"{urllib.parse.quote(user_name, safe='')}@" if user_name else ""
            host = f"[{host_name}]" if ":" in host_name else urllib.parse.quote(host_name, safe="")
            proto = "imap" if server_type == "imap" else ("mailbox" if server_type == "pop3" else server_type)
            root_uri = f"{proto}://{auth}{host}"

        discovered.append({
            "account": acc,
            "server_key": server_key,
            "type": server_type,
            "userName": user_name,
            "hostName": host_name,
            "prettyName": pretty_name or email or acc,
            "email": email,
            "domain": domain,
            "root_uri": root_uri,
        })

    return discovered


def generate_account_colors(accounts: list):
    """
    Groups accounts by domain and assigns lighter/darker variations of that domain's base color.
    """
    domain_groups = {}
    for acc in accounts:
        domain_groups.setdefault(acc["domain"], []).append(acc)

    assigned = {}
    for domain, items in domain_groups.items():
        if domain == "local":
            for it in items:
                assigned[it["account"]] = "#71717a"  # Slate grey for Local Folders
                it["color"] = "#71717a"
            continue

        base_hue = get_domain_hue(domain)
        n = len(items)

        # Variations in lightness and subtle hue shifts for accounts in the same domain
        if n == 1:
            lightness_steps = [50]
            hue_shifts = [0]
        elif n == 2:
            lightness_steps = [42, 62]
            hue_shifts = [-5, 5]
        elif n == 3:
            lightness_steps = [38, 52, 65]
            hue_shifts = [-8, 0, 8]
        elif n == 4:
            lightness_steps = [34, 46, 58, 68]
            hue_shifts = [-10, -4, 4, 10]
        else:
            step = 38.0 / (n - 1)
            lightness_steps = [32.0 + i * step for i in range(n)]
            hue_shifts = [((i - (n - 1) / 2.0) * 5.0) for i in range(n)]

        for idx, it in enumerate(items):
            l = lightness_steps[idx]
            h = base_hue + hue_shifts[idx]
            s = 82 if l > 55 else (88 if l < 40 else 84)
            hex_color = hsl_to_hex(h, s, l)
            assigned[it["account"]] = hex_color
            it["color"] = hex_color

    return accounts


def apply_colors_to_profile(roaming_dir: str):
    """
    Applies the domain-grouped colors to:
    1. folderTree.json (Thunderbird's native color persistence)
    2. chrome/userChrome.css (in the profile)
    """
    prefs_path = os.path.join(roaming_dir, "prefs.js")
    if not os.path.exists(prefs_path):
        print(f"Warning: prefs.js not found in {roaming_dir}")
        return []

    accounts = extract_accounts_from_prefs(prefs_path)
    if not accounts:
        print("No accounts found in profile.")
        return []

    generate_account_colors(accounts)

    # 1. Update folderTree.json
    folder_tree_path = os.path.join(roaming_dir, "folderTree.json")
    tree_data = {"open": {}, "colors": {}}
    if os.path.exists(folder_tree_path):
        try:
            with open(folder_tree_path, "r", encoding="utf-8") as f:
                tree_data = json.load(f)
        except Exception:
            pass

    tree_colors = tree_data.get("colors", {})
    for acc in accounts:
        color = acc.get("color")
        uri = acc.get("root_uri")
        if color and uri:
            tree_colors[uri] = color
            # Also register /INBOX for direct folder lookups
            if not uri.endswith("/INBOX"):
                tree_colors[f"{uri}/INBOX"] = color

    tree_data["colors"] = tree_colors
    with open(folder_tree_path, "w", encoding="utf-8") as f:
        json.dump(tree_data, f, indent=2)
    print(f"Updated {len(tree_colors)} color entries in folderTree.json")

    # 2. Update userChrome.css with CSS variables for each server
    user_chrome_path = os.path.join(roaming_dir, "chrome", "userChrome.css")
    if os.path.exists(user_chrome_path):
        with open(user_chrome_path, "r", encoding="utf-8") as f:
            css_content = f.read()

        css_lines = []
        css_lines.append("/* === AUTOMATIC DOMAIN-GROUPED ACCOUNT COLORS === */")
        css_lines.append(":root {")
        for acc in accounts:
            sk = acc["server_key"]
            col = acc.get("color")
            if sk and col:
                css_lines.append(f"  --server-{sk}-color: {col} !important;")
        css_lines.append("}")
        css_lines.append("")
        account_colors_css = "\n".join(css_lines)

        # Replace existing block if present, or prepend right after first :root
        pattern = r"/\* === AUTOMATIC DOMAIN-GROUPED ACCOUNT COLORS === \*/[\s\S]*?\}\n"
        if re.search(pattern, css_content):
            css_content = re.sub(pattern, account_colors_css, css_content)
        else:
            # Append to file
            css_content = css_content.rstrip() + "\n\n" + account_colors_css

        with open(user_chrome_path, "w", encoding="utf-8") as f:
            f.write(css_content)
        print("Updated server color variables in chrome/userChrome.css")

    return accounts


if __name__ == "__main__":
    import sys
    roaming = r"C:\Users\senor\AppData\Roaming\Thunderbird\Profiles\19hoarny.default-release"
    if len(sys.argv) > 1:
        roaming = sys.argv[1]

    print(f"Colorizing accounts for profile: {roaming}")
    results = apply_colors_to_profile(roaming)
    print("\nColor Assignment Summary:")
    print(f"{'Account':<10} {'Server':<10} {'Domain':<22} {'Email':<30} {'Color':<10}")
    print("-" * 84)
    for it in results:
        print(f"{it['account']:<10} {it['server_key']:<10} {it['domain']:<22} {it['email']:<30} {it.get('color', ''):<10}")
