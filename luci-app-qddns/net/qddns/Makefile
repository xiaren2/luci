# SPDX-License-Identifier: GPL-2.0-only

include $(TOPDIR)/rules.mk

PKG_NAME:=qddns
PKG_VERSION:=0.2.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=OpenAI

include $(INCLUDE_DIR)/package.mk

define Package/qddns
  SECTION:=net
  CATEGORY:=Network
  TITLE:=General-purpose DDNS platform with DUID-aware IPv6 sources
  DEPENDS:=+procd +ip-full +ucode +ucode-mod-fs +ucode-mod-uci
  URL:=https://example.invalid/qddns
endef

define Package/qddns/description
  qddns is a general-purpose DDNS engine for OpenWrt/ImmortalWrt.
  It supports multiple source types including DHCPv6 DUID/IAID IPv6 lookup.
endef

# 无需在容器内进行任何多余解压
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

# 核心简化：留空！不需要容器内有任何 Rust、GCC 工具链
define Build/Compile
	# Pre-compiled on host
endef

define Package/qddns/conffiles
/etc/config/qddns
endef

define Package/qddns/install
	$(INSTALL_DIR) $(1)/usr/bin
	# 直接拷贝注入进来的 prebuilt 二进制
	$(INSTALL_BIN) $(CURDIR)/bin/qddnsctl $(1)/usr/bin/qddnsctl
	$(INSTALL_BIN) $(CURDIR)/bin/qddnsd $(1)/usr/bin/qddnsd

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/qddns.init $(1)/etc/init.d/qddns

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/qddns.config $(1)/etc/config/qddns

	$(INSTALL_DIR) $(1)/usr/share/qddns
	$(INSTALL_DATA) ./files/state.example.json $(1)/usr/share/qddns/state.example.json
endef

$(eval $(call BuildPackage,qddns))	if ! command -v cargo >/dev/null 2>&1; then \
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; \
		. $(HOME)/.cargo/env; \
		rustup target add aarch64-unknown-linux-musl; \
	else \
		. $(HOME)/.cargo/env || true; \
	fi; \
	cd $(PKG_BUILD_DIR) && \
	~/.cargo/bin/cargo build --release --target=aarch64-unknown-linux-musl
	
	mkdir -p $(PKG_BUILD_DIR)/target/release
	cp $(PKG_BUILD_DIR)/target/aarch64-unknown-linux-musl/release/qddnsctl $(PKG_BUILD_DIR)/target/release/qddnsctl || true
	cp $(PKG_BUILD_DIR)/target/aarch64-unknown-linux-musl/release/qddnsd $(PKG_BUILD_DIR)/target/release/qddnsd || true
endef

define Package/qddns/conffiles
/etc/config/qddns
endef

define Package/qddns/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/target/release/qddnsctl $(1)/usr/bin/qddnsctl
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/target/release/qddnsd $(1)/usr/bin/qddnsd

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/qddns.init $(1)/etc/init.d/qddns

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/qddns.config $(1)/etc/config/qddns

	$(INSTALL_DIR) $(1)/usr/share/qddns
	$(INSTALL_DATA) ./files/state.example.json $(1)/usr/share/qddns/state.example.json
endef

$(eval $(call BuildPackage,qddns))
