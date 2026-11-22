#!/usr/bin/env python3
"""
Builds a standalone macOS .dmg disk image (release/DeltaAI-1.0.0.dmg) and macOS .app archive
(release/DeltaAI-macOS-1.0.0.zip) containing the compiled DeltaAI frontend (dist/),
backend (dist-server/server.js), Electron launcher (electron/main.cjs), and macOS DeltaAI.app bundle.
"""

import os
import sys
import stat
import time
import shutil
import struct
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
RELEASE_DIR = ROOT_DIR / "release"
STAGING_DIR = RELEASE_DIR / "dmg-staging"
APP_BUNDLE_DIR = STAGING_DIR / "DeltaAI.app"
DMG_OUTPUT_PATH = RELEASE_DIR / "DeltaAI-1.0.0.dmg"
ZIP_OUTPUT_PATH = RELEASE_DIR / "DeltaAI-macOS-1.0.0.zip"

INFO_PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>DeltaAI</string>
  <key>CFBundleExecutable</key>
  <string>DeltaAI</string>
  <key>CFBundleIdentifier</key>
  <string>com.deltaai.trading</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>DeltaAI</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.finance</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
"""

MACOS_EXECUTABLE_SCRIPT = """#!/bin/bash
# DeltaAI macOS Native App Bundle Launcher
set -e

CONTENTS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_RESOURCES_DIR="$CONTENTS_DIR/Resources/app"
PORT=3000
URL="http://localhost:$PORT"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$APP_RESOURCES_DIR"

# 1. If Electron binary is present locally, launch the native Electron window directly
if [ -x "$APP_RESOURCES_DIR/node_modules/.bin/electron" ]; then
  exec "$APP_RESOURCES_DIR/node_modules/.bin/electron" "$APP_RESOURCES_DIR"
fi

# 2. Otherwise start the standalone zero-dependency embedded Express + WebSocket server on port 3000
if ! lsof -i :$PORT >/dev/null 2>&1; then
  if [ -f "$APP_RESOURCES_DIR/dist-server/server.cjs" ]; then
    NODE_ENV=production PORT=$PORT node "$APP_RESOURCES_DIR/dist-server/server.cjs" >/tmp/deltaai-server.log 2>&1 &
  else
    NODE_ENV=production PORT=$PORT node "$APP_RESOURCES_DIR/dist-server/server.js" >/tmp/deltaai-server.log 2>&1 &
  fi
  SERVER_PID=$!
  trap "kill $SERVER_PID 2>/dev/null || true" EXIT
  sleep 1.2
fi

if [ -d "/Applications/Google Chrome.app" ]; then
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="$URL" --window-size=1440,900 >/dev/null 2>&1 &
elif [ -d "/Applications/Brave Browser.app" ]; then
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --app="$URL" --window-size=1440,900 >/dev/null 2>&1 &
else
  open "$URL"
fi

wait
"""

README_MACOS = """DeltaAI 1.0.0 — Complete macOS Desktop Package (.dmg)
======================================================

Included in this Disk Image (`DeltaAI-1.0.0.dmg`):
  • `DeltaAI.app` — Native macOS Application Bundle (`com.deltaai.trading`)
  • `Contents/Resources/app/dist/` — Compiled Production Frontend & PWA Assets
  • `Contents/Resources/app/dist-server/server.cjs` — Standalone Self-Contained Express + WebSocket Backend (all dependencies bundled)
  • `Contents/Resources/app/electron/main.cjs` — Electron Native Window Launcher (1440x900, Dark Titlebar)
  • `Contents/Resources/app/src/` & `server.ts` — Complete Full-Stack Source Code

How to Run on macOS:
--------------------
1. Drag `DeltaAI.app` into your `/Applications` folder.
2. If macOS Gatekeeper asks for confirmation on first open, run in Terminal:
   xattr -cr /Applications/DeltaAI.app
3. Double-click `DeltaAI.app` to launch.

Optional — Rebuild Native Electron `.dmg` on macOS:
---------------------------------------------------
  cd /Applications/DeltaAI.app/Contents/Resources/app
  npm install
  npm run build:mac:electron
"""


def build_staging_bundle():
    if STAGING_DIR.exists():
        shutil.rmtree(STAGING_DIR)
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)

    macos_dir = APP_BUNDLE_DIR / "Contents" / "MacOS"
    resources_app_dir = APP_BUNDLE_DIR / "Contents" / "Resources" / "app"
    macos_dir.mkdir(parents=True, exist_ok=True)
    resources_app_dir.mkdir(parents=True, exist_ok=True)

    # Write Info.plist
    (APP_BUNDLE_DIR / "Contents" / "Info.plist").write_text(INFO_PLIST, encoding="utf-8")

    # Write MacOS executable launcher
    launcher_path = macos_dir / "DeltaAI"
    launcher_path.write_text(MACOS_EXECUTABLE_SCRIPT, encoding="utf-8")
    launcher_path.chmod(0o755)

    # Write README inside DMG root
    (STAGING_DIR / "README-macOS.txt").write_text(README_MACOS, encoding="utf-8")

    # Copy the complete package: compiled dist/, dist-server/, electron/, src/, public/, scripts/
    for folder_name in ["dist", "dist-server", "electron", "src", "public", "scripts"]:
        src_folder = ROOT_DIR / folder_name
        if src_folder.exists():
            dst_folder = resources_app_dir / folder_name
            dst_folder.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src_folder, dst_folder, dirs_exist_ok=True)

    for file_name in [
        "package.json",
        "server.ts",
        "index.html",
        "vite.config.ts",
        "tsconfig.json",
        "metadata.json",
        ".env.example",
    ]:
        src_file = ROOT_DIR / file_name
        if src_file.exists():
            shutil.copy2(src_file, resources_app_dir / file_name)


def build_zip_bundle():
    if ZIP_OUTPUT_PATH.exists():
        ZIP_OUTPUT_PATH.unlink()

    with zipfile.ZipFile(ZIP_OUTPUT_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(STAGING_DIR):
            rel_root = Path(root).relative_to(STAGING_DIR)
            for d in dirs:
                dir_path = Path(root) / d
                rel_dir = (rel_root / d).as_posix() + "/"
                zinfo = zipfile.ZipInfo(rel_dir)
                zinfo.external_attr = (0o40755 << 16) | 0x10
                zf.writestr(zinfo, b"")
            for f in files:
                file_path = Path(root) / f
                rel_file = (rel_root / f).as_posix()
                st = file_path.stat()
                zinfo = zipfile.ZipInfo(rel_file, time.localtime(st.st_mtime)[:6])
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                mode = stat.S_IMODE(st.st_mode)
                zinfo.external_attr = (0o100000 | mode) << 16
                zf.writestr(zinfo, file_path.read_bytes())


def pad_sector(data: bytes, sector_size: int = 2048) -> bytes:
    rem = len(data) % sector_size
    if rem == 0:
        return data
    return data + b"\x00" * (sector_size - rem)


def both_endian_16(val: int) -> bytes:
    return struct.pack("<H", val) + struct.pack(">H", val)


def both_endian_32(val: int) -> bytes:
    return struct.pack("<I", val) + struct.pack(">I", val)


def build_iso9660_dmg(staging_dir: Path, output_dmg: Path, volume_name: str = "DeltaAI"):
    """
    Creates a standards-compliant ISO-9660 + Joliet (UCS-2 Level 3) hybrid .dmg image
    that macOS DiskImageMounter mounts natively in Finder with full mixed-case filenames.
    """
    SECTOR = 2048

    # Collect directory tree
    nodes = {}

    def scan_dir(path: Path, rel: str):
        dirs = []
        files = []
        for entry in sorted(path.iterdir(), key=lambda p: p.name.lower()):
            child_rel = f"{rel}/{entry.name}" if rel else entry.name
            if entry.is_dir():
                dirs.append((entry.name, child_rel))
                scan_dir(entry, child_rel)
            elif entry.is_file():
                files.append((entry.name, entry))
        nodes[rel] = {"dirs": dirs, "files": files}

    scan_dir(staging_dir, "")

    # Order directories breadth-first for Path Table
    bfs_dirs = [""]
    parent_idx_map = {"": 1}
    queue = [""]
    while queue:
        cur = queue.pop(0)
        cur_idx = bfs_dirs.index(cur) + 1
        for d_name, d_rel in nodes[cur]["dirs"]:
            bfs_dirs.append(d_rel)
            parent_idx_map[d_rel] = cur_idx
            queue.append(d_rel)

    # Layout sectors:
    # 0..15: System Area (16 sectors)
    # 16: Primary Volume Descriptor (PVD)
    # 17: Supplementary Volume Descriptor (Joliet UCS-2 Level 3 for full macOS filenames)
    # 18: Volume Descriptor Set Terminator
    # 19: Primary L-Path Table
    # 20: Primary M-Path Table
    # 21: Joliet L-Path Table
    # 22: Joliet M-Path Table
    next_sector = 23

    # Allocate sectors for file contents (shared between Primary and Joliet trees)
    file_alloc = {}
    for rel_dir in bfs_dirs:
        for f_name, f_path in nodes[rel_dir]["files"]:
            size = f_path.stat().st_size
            sectors_needed = max(1, (size + SECTOR - 1) // SECTOR) if size > 0 else 0
            start_sec = next_sector if sectors_needed > 0 else 0
            file_alloc[str(f_path)] = (start_sec, size, f_path)
            next_sector += sectors_needed

    def make_dir_record(name_bytes: bytes, extent_sector: int, data_len: int, is_dir: bool) -> bytes:
        flags = 0x02 if is_dir else 0x00
        now = time.gmtime()
        date_bytes = struct.pack(
            "BBBBBBb",
            now.tm_year - 1900,
            now.tm_mon,
            now.tm_mday,
            now.tm_hour,
            now.tm_min,
            now.tm_sec,
            0,
        )
        name_len = len(name_bytes)
        rec_len = 33 + name_len
        if rec_len % 2 == 1:
            rec_len += 1
            pad = b"\x00"
        else:
            pad = b""
        header = (
            struct.pack("B", rec_len)
            + struct.pack("B", 0)
            + both_endian_32(extent_sector)
            + both_endian_32(data_len)
            + date_bytes
            + struct.pack("B", flags)
            + struct.pack("B", 0)
            + struct.pack("B", 0)
            + both_endian_16(1)
            + struct.pack("B", name_len)
            + name_bytes
            + pad
        )
        return header

    def iso_safe_name(name: str, is_dir: bool) -> bytes:
        cleaned = "".join(c if c.isalnum() or c in "._-" else "_" for c in name.upper())
        if not is_dir:
            cleaned = cleaned[:28] + ";1"
        else:
            cleaned = cleaned[:30]
        return cleaned.encode("ascii", errors="replace")

    def joliet_name(name: str, is_dir: bool) -> bytes:
        trimmed = name[:64]
        return trimmed.encode("utf-16-be")

    def build_dir_tree(use_joliet: bool, start_sec: int):
        # First pass: estimate 1 sector per directory, refine if needed
        dir_sectors = {d: start_sec + idx for idx, d in enumerate(bfs_dirs)}
        dir_sizes = {d: SECTOR for d in bfs_dirs}

        for _ in range(2):
            cur_sec = start_sec
            dir_blobs = {}
            for d in bfs_dirs:
                parent_d = "/".join(d.split("/")[:-1]) if "/" in d else ""
                records = []
                records.append(make_dir_record(b"\x00", dir_sectors[d], dir_sizes[d], True))
                records.append(make_dir_record(b"\x01", dir_sectors[parent_d], dir_sizes[parent_d], True))

                for sub_name, sub_rel in nodes[d]["dirs"]:
                    nb = joliet_name(sub_name, True) if use_joliet else iso_safe_name(sub_name, True)
                    records.append(make_dir_record(nb, dir_sectors[sub_rel], dir_sizes[sub_rel], True))

                for f_name, f_path in nodes[d]["files"]:
                    f_sec, f_size, _ = file_alloc[str(f_path)]
                    nb = joliet_name(f_name, False) if use_joliet else iso_safe_name(f_name, False)
                    records.append(make_dir_record(nb, f_sec, f_size, False))

                # Pack records into sectors without crossing sector boundaries
                sector_bufs = []
                cur_buf = bytearray()
                for rec in records:
                    if len(cur_buf) + len(rec) > SECTOR:
                        cur_buf.extend(b"\x00" * (SECTOR - len(cur_buf)))
                        sector_bufs.append(bytes(cur_buf))
                        cur_buf = bytearray()
                    cur_buf.extend(rec)
                if cur_buf or not sector_bufs:
                    cur_buf.extend(b"\x00" * (SECTOR - len(cur_buf)))
                    sector_bufs.append(bytes(cur_buf))

                blob = b"".join(sector_bufs)
                dir_sectors[d] = cur_sec
                dir_sizes[d] = len(blob)
                dir_blobs[d] = blob
                cur_sec += len(blob) // SECTOR

        return dir_sectors, dir_sizes, dir_blobs, cur_sec

    iso_sectors, iso_sizes, iso_blobs, after_iso_sec = build_dir_tree(False, next_sector)
    jol_sectors, jol_sizes, jol_blobs, total_sectors = build_dir_tree(True, after_iso_sec)

    def build_path_table(use_joliet: bool, big_endian: bool, dir_secs: dict) -> bytes:
        out = bytearray()
        for d in bfs_dirs:
            if d == "":
                nb = b"\x00"
            else:
                base = d.split("/")[-1]
                nb = joliet_name(base, True) if use_joliet else iso_safe_name(base, True)
            nlen = len(nb)
            extent = dir_secs[d]
            p_idx = parent_idx_map[d]
            out.append(nlen)
            out.append(0)
            out.extend(struct.pack(">I" if big_endian else "<I", extent))
            out.extend(struct.pack(">H" if big_endian else "<H", p_idx))
            out.extend(nb)
            if nlen % 2 == 1:
                out.append(0)
        return bytes(out)

    iso_pt_l = build_path_table(False, False, iso_sectors)
    iso_pt_m = build_path_table(False, True, iso_sectors)
    jol_pt_l = build_path_table(True, False, jol_sectors)
    jol_pt_m = build_path_table(True, True, jol_sectors)

    def build_volume_descriptor(vd_type: int, use_joliet: bool, root_sec: int, root_size: int, pt_len: int, pt_l_sec: int, pt_m_sec: int) -> bytes:
        vd = bytearray(SECTOR)
        vd[0] = vd_type
        vd[1:6] = b"CD001"
        vd[6] = 1
        if use_joliet:
            # UCS-2 Level 3 escape sequence: %/E
            vd[8:40] = "MACOS".encode("utf-16-be").ljust(32, b"\x00")
            vd[40:72] = volume_name[:16].encode("utf-16-be").ljust(32, b"\x00")
            vd[88:91] = b"%/E"
        else:
            vd[8:40] = b"MACOS".ljust(32, b" ")
            vd[40:72] = volume_name.upper().encode("ascii")[:32].ljust(32, b" ")

        vd[80:88] = both_endian_32(total_sectors)
        vd[120:124] = both_endian_16(1)
        vd[124:128] = both_endian_16(1)
        vd[128:132] = both_endian_16(SECTOR)
        vd[132:140] = both_endian_32(pt_len)
        vd[140:144] = struct.pack("<I", pt_l_sec)
        vd[148:152] = struct.pack(">I", pt_m_sec)
        root_rec = make_dir_record(b"\x00", root_sec, root_size, True)
        vd[156 : 156 + len(root_rec)] = root_rec
        vd[881] = 1
        return bytes(vd)

    pvd = build_volume_descriptor(1, False, iso_sectors[""], iso_sizes[""], len(iso_pt_l), 19, 20)
    svd = build_volume_descriptor(2, True, jol_sectors[""], jol_sizes[""], len(jol_pt_l), 21, 22)
    tvd = bytearray(SECTOR)
    tvd[0] = 255
    tvd[1:6] = b"CD001"
    tvd[6] = 1

    with open(output_dmg, "wb") as f:
        # 0..15: System area
        f.write(b"\x00" * (16 * SECTOR))
        # 16: PVD
        f.write(pvd)
        # 17: SVD (Joliet)
        f.write(svd)
        # 18: Terminator
        f.write(bytes(tvd))
        # 19..22: Path tables
        f.write(pad_sector(iso_pt_l))
        f.write(pad_sector(iso_pt_m))
        f.write(pad_sector(jol_pt_l))
        f.write(pad_sector(jol_pt_m))

        # File contents
        for rel_dir in bfs_dirs:
            for f_name, f_path in nodes[rel_dir]["files"]:
                f_sec, f_size, _ = file_alloc[str(f_path)]
                if f_size > 0:
                    data = f_path.read_bytes()
                    f.write(pad_sector(data))

        # ISO directory blobs
        for d in bfs_dirs:
            f.write(iso_blobs[d])

        # Joliet directory blobs
        for d in bfs_dirs:
            f.write(jol_blobs[d])


def main():
    print("[DeltaAI macOS Packager] Building DeltaAI.app bundle and DeltaAI-1.0.0.dmg...")
    build_staging_bundle()
    build_zip_bundle()
    build_iso9660_dmg(STAGING_DIR, DMG_OUTPUT_PATH, volume_name="DeltaAI")

    dmg_size_mb = DMG_OUTPUT_PATH.stat().st_size / (1024 * 1024)
    zip_size_mb = ZIP_OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"[DeltaAI macOS Packager] Generated {DMG_OUTPUT_PATH} ({dmg_size_mb:.2f} MB)")
    print(f"[DeltaAI macOS Packager] Generated {ZIP_OUTPUT_PATH} ({zip_size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
