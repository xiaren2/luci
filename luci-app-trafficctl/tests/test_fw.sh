#!/bin/bash
# Unit tests for trafficctl-fw.sh helper functions.

PASS=0
FAIL=0

assert_eq() {
    local desc="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        printf "FAIL: %s\n  expected: '%s'\n  actual:   '%s'\n" "$desc" "$expected" "$actual"
    fi
}

# Stub out commands that don't exist outside OpenWrt
uci() { echo ""; }
nft() { return 1; }
command() { return 1; }
export -f uci nft command

# Source the firewall library (will fall back to iptables mode)
. "$(dirname "$0")/../root/usr/local/bin/trafficctl-fw.sh"

# --- tctl_validate_ip ---

assert_eq "valid IP 192.168.1.1" 0 "$(tctl_validate_ip '192.168.1.1' && echo 0 || echo 1)"
assert_eq "valid IP 10.0.0.1" 0 "$(tctl_validate_ip '10.0.0.1' && echo 0 || echo 1)"
assert_eq "valid IP 255.255.255.255" 0 "$(tctl_validate_ip '255.255.255.255' && echo 0 || echo 1)"
assert_eq "valid IP 0.0.0.0" 0 "$(tctl_validate_ip '0.0.0.0' && echo 0 || echo 1)"

assert_eq "invalid IP empty" 1 "$(tctl_validate_ip '' && echo 0 || echo 1)"
assert_eq "invalid IP letters" 1 "$(tctl_validate_ip 'abc.def.ghi.jkl' && echo 0 || echo 1)"
assert_eq "invalid IP 256.1.1.1" 1 "$(tctl_validate_ip '256.1.1.1' && echo 0 || echo 1)"
assert_eq "invalid IP 1.1.1.999" 1 "$(tctl_validate_ip '1.1.1.999' && echo 0 || echo 1)"
assert_eq "invalid IP too few octets" 1 "$(tctl_validate_ip '192.168.1' && echo 0 || echo 1)"
assert_eq "invalid IP with spaces" 1 "$(tctl_validate_ip '192.168.1.1 ; rm -rf /' && echo 0 || echo 1)"
assert_eq "invalid IP CIDR" 1 "$(tctl_validate_ip '192.168.1.0/24' && echo 0 || echo 1)"
assert_eq "invalid IP trailing dot" 1 "$(tctl_validate_ip '192.168.1.1.' && echo 0 || echo 1)"

# --- tctl_get_lan_device (fallback) ---

assert_eq "lan device fallback" "br-lan" "$(tctl_get_lan_device)"

# --- tctl_get_wan_device (fallback) ---

assert_eq "wan device fallback" "wan" "$(tctl_get_wan_device)"

# --- TCTL_FW detection ---

assert_eq "firewall mode is iptables when nft unavailable" "iptables" "$TCTL_FW"

# --- Results ---

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
