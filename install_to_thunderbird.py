import argparse
import configparser
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import zipfile

from account_colors import apply_colors_to_profile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")
DIST_DIR = os.path.join(BASE_DIR, "dist")
CHROME_CSS = os.path.join(BASE_DIR, "chrome", "userChrome.css")
USER_JS = os.path.join(BASE_DIR, "user.js")

STANDALONE_ADDON_ID = "modern-cards-view@thunderbird.addon"
DROPIN_ADDON_ID = "autoprofilepicture@astucesweb.fr"


def find_thunderbird_profiles():
    system = platform.system()
    home = os.path.expanduser("~")
    candidate_roots = []

    if system == "Windows":
        appdata = os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming"))
        localappdata = os.environ.get("LOCALAPPDATA", os.path.join(home, "AppData", "Local"))
        candidate_roots.append((os.path.join(appdata, "Thunderbird"), os.path.join(localappdata, "Thunderbird")))
    elif system == "Darwin":
        tb_dir = os.path.join(home, "Library", "Thunderbird")
        candidate_roots.append((tb_dir, os.path.join(home, "Library", "Caches", "Thunderbird")))
    else:
        # Linux (standard + Flatpak + Snap)
        candidate_roots.append((os.path.join(home, ".thunderbird"), os.path.join(home, ".cache", "thunderbird")))
        candidate_roots.append((
            os.path.join(home, ".var", "app", "org.mozilla.Thunderbird", ".thunderbird"),
            os.path.join(home, ".var", "app", "org.mozilla.Thunderbird", "cache", "thunderbird"),
        ))
        candidate_roots.append((
            os.path.join(home, "snap", "thunderbird", "common", ".thunderbird"),
            os.path.join(home, "snap", "thunderbird", "common", ".cache", "thunderbird"),
        ))

    profiles = []
    for tb_roaming, tb_local in candidate_roots:
        profiles_ini = os.path.join(tb_roaming, "profiles.ini")
        if not os.path.exists(profiles_ini):
            continue
        cp = configparser.ConfigParser()
        cp.read(profiles_ini, encoding="utf-8")
        for section in cp.sections():
            if cp.has_option(section, "Path"):
                rel = cp.get(section, "Path")
                is_rel = cp.get(section, "IsRelative", fallback="1") == "1"
                full_roaming = os.path.normpath(os.path.join(tb_roaming, rel) if is_rel else rel)
                full_local = os.path.normpath(os.path.join(tb_local, rel) if is_rel else rel)
                if os.path.exists(full_roaming) and "default-release" in os.path.basename(full_roaming):
                    profiles.insert(0, (full_roaming, full_local))
                elif os.path.exists(full_roaming):
                    profiles.append((full_roaming, full_local))
    return profiles


def close_thunderbird():
    system = platform.system()
    if system == "Windows":
        subprocess.run(["taskkill", "/F", "/IM", "thunderbird.exe", "/T"], capture_output=True)
    else:
        subprocess.run(["pkill", "-f", "thunderbird"], capture_output=True)


def build_xpis():
    os.makedirs(DIST_DIR, exist_ok=True)

    # Collect files from src/
    items = {}
    for root, _, files in os.walk(SRC_DIR):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, SRC_DIR).replace("\\", "/")
            with open(full_path, "rb") as f:
                items[rel_path] = f.read()

    # Build standalone XPI (modern-cards-view@thunderbird.addon.xpi)
    standalone_xpi = os.path.join(DIST_DIR, f"{STANDALONE_ADDON_ID}.xpi")
    with zipfile.ZipFile(standalone_xpi, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, content in items.items():
            zout.writestr(name, content)

    # Build drop-in profile XPI (autoprofilepicture@astucesweb.fr.xpi)
    manifest = json.loads(items["manifest.json"].decode("utf-8"))
    manifest["browser_specific_settings"]["gecko"]["id"] = DROPIN_ADDON_ID
    items_dropin = dict(items)
    items_dropin["manifest.json"] = json.dumps(manifest, indent=2).encode("utf-8")
    dropin_xpi = os.path.join(DIST_DIR, f"{DROPIN_ADDON_ID}.xpi")
    with zipfile.ZipFile(dropin_xpi, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, content in items_dropin.items():
            zout.writestr(name, content)

    return standalone_xpi, dropin_xpi


def main():
    parser = argparse.ArgumentParser(description="Build and install Thunderbird Modern Cards View")
    parser.add_argument("--build-only", action="store_true", help="Only build the XPI packages in dist/ without modifying a profile")
    parser.add_argument("--profile", type=str, default=None, help="Explicit path to a Thunderbird profile directory")
    parser.add_argument("--no-account-colors", action="store_true", help="Skip automatic domain-based account color-coding")
    args = parser.parse_args()

    print("=== Thunderbird Modern Cards View Installer ===")
    standalone_xpi, dropin_xpi = build_xpis()
    print(f"Built XPIs in: {DIST_DIR}")

    if args.build_only:
        return

    if args.profile:
        roaming_dir = os.path.abspath(args.profile)
        local_dir = roaming_dir
    else:
        profiles = find_thunderbird_profiles()
        if not profiles:
            print("No Thunderbird profile found automatically. Pass --profile <path> or install the XPI from dist/ manually.")
            sys.exit(1)
        roaming_dir, local_dir = profiles[0]

    print(f"Target Thunderbird profile: {roaming_dir}")

    # Close Thunderbird if running
    close_thunderbird()
    time.sleep(1.5)

    # Remove stale parent.lock if left over from forced close
    lock_file = os.path.join(roaming_dir, "parent.lock")
    if os.path.exists(lock_file):
        try:
            os.remove(lock_file)
            print("Removed stale parent.lock")
        except OSError:
            pass

    # 1. Copy chrome/userChrome.css
    target_chrome_dir = os.path.join(roaming_dir, "chrome")
    os.makedirs(target_chrome_dir, exist_ok=True)
    shutil.copy2(CHROME_CSS, os.path.join(target_chrome_dir, "userChrome.css"))
    print("Installed chrome/userChrome.css")

    # 2. Copy user.js
    shutil.copy2(USER_JS, os.path.join(roaming_dir, "user.js"))
    print("Installed user.js")

    # 3. Copy XPI to extensions/
    ext_dir = os.path.join(roaming_dir, "extensions")
    os.makedirs(ext_dir, exist_ok=True)
    target_xpi = os.path.join(ext_dir, f"{DROPIN_ADDON_ID}.xpi")
    for _ in range(15):
        try:
            shutil.copy2(dropin_xpi, target_xpi)
            break
        except OSError:
            close_thunderbird()
            time.sleep(0.8)
    print("Installed extension XPI")

    # 4. Update extensions.json to lock compatibility and disable store overwrite (applyBackgroundUpdates = 0)
    ext_json_path = os.path.join(roaming_dir, "extensions.json")
    if os.path.exists(ext_json_path):
        with open(ext_json_path, "r", encoding="utf-8") as f:
            ext_data = json.load(f)
        for addon in ext_data.get("addons", []):
            if addon.get("id") in (DROPIN_ADDON_ID, STANDALONE_ADDON_ID):
                addon["active"] = True
                addon["appDisabled"] = False
                addon["userDisabled"] = False
                addon["softDisabled"] = False
                addon["foreignInstall"] = False
                addon["strictCompatibility"] = False
                addon["applyBackgroundUpdates"] = 0
                for ta in addon.get("targetApplications", []):
                    ta["maxVersion"] = "*"
        with open(ext_json_path, "w", encoding="utf-8") as f:
            json.dump(ext_data, f, separators=(",", ":"))
        print("Locked extension active state and disabled store auto-overwrite in extensions.json")

    # 5. Apply domain-grouped account color-coding (folderTree.json and userChrome.css)
    if not args.no_account_colors:
        print("\n--- Applying Domain-Grouped Account Color-Coding ---")
        assigned_accounts = apply_colors_to_profile(roaming_dir)
        if assigned_accounts:
            print(f"{'Account':<10} {'Domain':<22} {'Email':<30} {'Color':<10}")
            print("-" * 74)
            for it in assigned_accounts:
                print(f"{it['account']:<10} {it['domain']:<22} {it['email']:<30} {it.get('color', ''):<10}")

    # 6. Remove stale AMO metadata cache and startupCache
    addons_json = os.path.join(roaming_dir, "addons.json")
    if os.path.exists(addons_json):
        os.remove(addons_json)
    for cache_root in (local_dir, roaming_dir):
        startup_cache = os.path.join(cache_root, "startupCache")
        if os.path.exists(startup_cache):
            shutil.rmtree(startup_cache, ignore_errors=True)
            print("Cleared startupCache")

    print("\nAll done! You can now start Thunderbird.")


if __name__ == "__main__":
    main()
