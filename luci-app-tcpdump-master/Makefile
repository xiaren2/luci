# Copyright (C) 2016 Openwrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#
# Copyright (C) 2019, KFERMercer <iMercer@yeah.net>
# Copyright (C) 2025, fully migrated to LuCI JS + rpcd backend (no Lua)
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for tcpdump
LUCI_DEPENDS:=+tcpdump +rpcd +luci-base +jq
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-tcpdump
PKG_VERSION:=2.0
PKG_RELEASE:=2
PKG_MAINTAINER:=<https://github.com/KFERMercer/luci-app-tcpdump>

include $(TOPDIR)/feeds/luci/luci.mk

# Ensure rpcd script is executable after install
define Package/luci-app-tcpdump/postinst
#!/bin/sh
chmod +x $${IPKG_INSTROOT}/usr/libexec/rpcd/luci.tcpdump 2>/dev/null
/etc/init.d/rpcd reload 2>/dev/null
exit 0
endef

# call BuildPackage - OpenWrt buildroot signature
