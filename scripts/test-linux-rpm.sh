#!/bin/bash
# Run only in the disposable Fedora image. Arguments: source, RPM directory, public key.
set -euo pipefail
source_dir="$1"
installer_dir="$2"
public_key="$3"
rpm --import "$public_key"
rpm --checksig "$installer_dir"/Milagre-*-x86_64.rpm
dnf --setopt=localpkg_gpgcheck=1 install -y "$installer_dir"/Milagre-*-x86_64.rpm
desktop-file-validate /usr/share/applications/milagre.desktop
mkdir -p /workspace
cp -a "$source_dir"/. /workspace/
chown -R tester:tester /workspace
runuser -u tester -- bash -c 'cd /workspace; npm ci > /tmp/milagre-npm.log 2>&1; npm run build > /tmp/milagre-build.log 2>&1; xvfb-run -a node scripts/test-desktop.cjs --packaged /opt/Milagre/milagre'
