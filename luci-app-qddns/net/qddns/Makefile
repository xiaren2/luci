# SPDX-License-Identifier: GPL-2.0-only

include $(TOPDIR)/rules.mk

PKG_NAME:=qddns
PKG_VERSION:=0.2.0
PKG_RELEASE:=1

PKG_LICENSE:=GPL-2.0-only
PKG_MAINTAINER:=OpenAI

PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/qddns
  SECTION:=net
  CATEGORY:=Network
  TITLE:=General-purpose DDNS platform with DUID-aware IPv6 sources
  # 去掉了原有的 $(RUST_ARCH_DEPENDS)，改为纯净依赖
  DEPENDS:=+procd +ip-full +ucode +ucode-mod-fs +ucode-mod-uci
  URL:=https://example.invalid/qddns
endef

define Package/qddns/description
  qddns is a general-purpose DDNS engine for OpenWrt/ImmortalWrt.
  It supports multiple source types including DHCPv6 DUID/IAID IPv6 lookup.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) $(CURDIR)/../../qddns/* $(PKG_BUILD_DIR)/
endef

# 🔥 核心改动：直接借用系统的 cargo 针对目标架构进行交叉编译
define Build/Compile
	cd $(PKG_BUILD_DIR) && \
	CARGO_HOME=/usr/share/rust/.cargo \
	RUSTUP_HOME=/usr/share/rust/.rustup \
	cargo build --release --target=$(TARGET_CROSS:-=)
	
	# 创建一个伪造的二进制目录，方便下面的 install 阶段复制
	mkdir -p $(PKG_BUILD_DIR)/target/release
	# 将交叉编译出的二进制软链接或复制过去
	cp $(PKG_BUILD_DIR)/target/$(TARGET_CROSS:-=)/release/qddnsctl $(PKG_BUILD_DIR)/target/release/qddnsctl || true
	cp $(PKG_BUILD_DIR)/target/$(TARGET_CROSS:-=)/release/qddnsd $(PKG_BUILD_DIR)/target/release/qddnsd || true
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
