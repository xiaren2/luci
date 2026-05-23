fork from https://github.com/lemonjc/luci-app-onliner-overview.git

# luci-app-onliner-overview

修改了位置，修改了部分内容

<img width="1456" height="760" alt="image" src="https://github.com/user-attachments/assets/d4522e84-053a-490b-b905-25f029aa1d7c" />

A lightweight LuCI overview widget for OpenWrt / ImmortalWrt.

It displays online clients directly on the LuCI **Status → Overview** page.  
This package does not add a standalone menu entry or configuration page.

## Features

- Show online clients on the LuCI overview page
- Display hostname, IP address, MAC address and interface
- Uses `rpcd` + `ucode` backend
- Supports English and Simplified Chinese

## Build

Clone this package into your OpenWrt / ImmortalWrt source tree:

```sh
cd openwrt
git clone https://github.com/lemonjc/luci-app-onliner-overview.git package/custom/luci-app-onliner-overview
```

Select the package:

```sh
make menuconfig
```

Path:

```text
LuCI -> Applications -> luci-app-onliner-overview
```

Build:

```sh
make package/custom/luci-app-onliner-overview/compile V=s
```

The `.ipk` package will usually be generated under:

```text
bin/packages/<architecture>/base/
```

## Install

Upload the `.ipk` file to your router and install it:

```sh
opkg install /tmp/luci-app-onliner-overview_*.ipk
```

Restart services and clear LuCI cache:

```sh
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart
rm -f /tmp/luci-indexcache
rm -rf /tmp/luci-modulecache/*
```

Then log out of LuCI, log in again, and refresh the overview page.

## Test

Check the backend:

```sh
ubus list | grep luci.onliner
ubus call luci.onliner getOnlineUserlist
```

Example output:

```json
{
  "userlist": [
    {
      "hostname": "phone",
      "ipaddr": "192.168.1.23",
      "macaddr": "aa:bb:cc:dd:ee:ff",
      "device": "br-lan"
    }
  ]
}
```

## Notes

Client detection is based on DHCP leases, ARP entries and IPv6 neighbor entries, so the list may not always represent strict real-time online status.

## License

MIT
