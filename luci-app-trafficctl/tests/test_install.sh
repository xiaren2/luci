#!/bin/sh
# Runs INSIDE an OpenWrt rootfs Docker container.
# Usage: sh /tests/test_install.sh /dist/luci-app-trafficctl_*.ipk
# Does NOT use opkg — extracts the IPK directly so the test works on any
# rootfs image regardless of its arch configuration.
set -e

IPK="$1"

[ -f "$IPK" ] || { echo "IPK not found: $IPK"; exit 1; }

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# IPK is a tar.gz containing: debian-binary, control.tar.gz, data.tar.gz
tar xzf "$IPK" -C "$TMPDIR"

# Install package files directly into the filesystem root
tar xzf "$TMPDIR/data.tar.gz" -C /

# Verify all expected files are present
for f in \
  /usr/local/bin/trafficctl-summary.sh \
  /usr/local/bin/trafficctl-fw.sh \
  /usr/local/bin/trafficctl-device.sh \
  /usr/local/bin/trafficctl-telegram.sh \
  /usr/local/bin/trafficctl-telegram-test.sh \
  /usr/local/bin/trafficctl-block.sh \
  /usr/local/bin/trafficctl-unblock.sh \
  /usr/local/bin/trafficctl-ratelimit.sh \
  /usr/local/bin/trafficctl-ratelimit-stats.sh \
  /usr/local/bin/trafficctl-shape.sh \
  /usr/local/bin/trafficctl-shape-stats.sh \
  /usr/local/bin/trafficctl-bytes.sh \
  /usr/local/bin/trafficctl-rdns.sh \
  /usr/local/bin/trafficctl-macfilter-add.sh \
  /usr/local/bin/trafficctl-macfilter-remove.sh \
  /usr/libexec/rpcd/luci.trafficctl \
  /www/luci-static/resources/view/trafficctl/status.js \
  /usr/share/luci/menu.d/luci-app-trafficctl.json \
  /usr/share/rpcd/acl.d/luci-app-trafficctl.json \
  /etc/config/trafficctl \
  /etc/hotplug.d/dhcp/99-trafficctl-newdevice \
  /etc/hotplug.d/iface/99-trafficctl-shapes \
  /etc/init.d/trafficctl-telegram; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done

# Verify syntax for all shell scripts
for s in \
  /usr/local/bin/trafficctl-*.sh \
  /usr/libexec/rpcd/luci.trafficctl \
  /etc/hotplug.d/dhcp/99-trafficctl-newdevice \
  /etc/hotplug.d/iface/99-trafficctl-shapes \
  /etc/init.d/trafficctl-telegram; do
  ash -n "$s" || { echo "SYNTAX ERROR: $s"; exit 1; }
done

# Verify execute bit on files that are called directly (not via sh)
for s in \
  /usr/local/bin/trafficctl-*.sh \
  /usr/libexec/rpcd/luci.trafficctl \
  /etc/init.d/trafficctl-telegram; do
  [ -x "$s" ] || { echo "NOT EXECUTABLE: $s"; exit 1; }
done

echo "All checks passed."
