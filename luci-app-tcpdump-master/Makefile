#
#  Copyright (C) 2025-2026
#
#  This is free software, licensed under the GNU General Public License v3.

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-tcpdump
PKG_VERSION:=1.3
PKG_RELEASE:=1

PKG_BUILD_DIR := $(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  TITLE:=LuCI js-ified app for tcpdump
  DEPENDS:=+tcpdump +libuci-lua
  PKGARCH:=all
endef

define Package/$(PKG_NAME)/description
    LuCI App for configuring TCP dumps - js-ified for OpenWrt SDK 23.05+
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(CP) ./luasrc/controller/* $(1)/usr/lib/lua/luci/controller/

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/i18n
	$(INSTALL_DATA) ./po/zh_Hans/*.po $(1)/usr/lib/lua/luci/i18n/zh_Hans/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view
	$(INSTALL_DATA) ./www/luci-static/resources/view/*.js \
		$(1)/www/luci-static/resources/view/
endef

$(eval $(call BuildPackage,$(PKG_NAME)))