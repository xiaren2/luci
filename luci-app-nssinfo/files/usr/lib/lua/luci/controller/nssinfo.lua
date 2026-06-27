module("luci.controller.nssinfo", package.seeall)

function index()
    -- 注册状态主页（指向你的 view/nssinfo/index.htm）
    entry({"admin", "status", "nssinfo"}, template("nssinfo/index"), _("NSS Info"), 80)
    -- 注册给 Ajax 刷新的数据接口
    entry({"admin", "status", "nssinfo_data"}, call("action_data"), nil).leaf = true
end

function action_data()
    local luci = require "luci.util"
    local json = require "luci.jsonc"

    -- 1. 采集温度
    local cpu_temp = tonumber(luci.exec("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null")) or 0
    if cpu_temp > 1000 then cpu_temp = math.floor(cpu_temp / 1000) end

    local w24 = tonumber(luci.exec("cat /sys/class/net/wifi1/thermal/temp 2>/dev/null")) or 0
    local w5 = tonumber(luci.exec("cat /sys/class/net/wifi0/thermal/temp 2>/dev/null")) or 0
    local wg = tonumber(luci.exec("cat /sys/class/net/wifi2/thermal/temp 2>/dev/null")) or 0

    -- 2. 采集 NSS / ECM 数据
    local ecm_avail = 0
    local db_tcp, db_udp, db_other, db_total = 0, 0, 0, 0
    local v4_acc, v4_tcp, v4_udp, v4_icmp = 0, 0, 0, 0
    local v6_acc, v6_tcp, v6_udp, v6_icmp = 0, 0, 0, 0

    if luci.exec("[ -d /sys/kernel/debug/ecm ] && echo 1") == "1\n" then
        ecm_avail = 1
        -- 解析 ecm_db 连接数
        local ds = luci.exec("cat /sys/kernel/debug/ecm/ecm_db/connection_count_simple 2>/dev/null") or ""
        db_tcp = tonumber(ds:match("tcp%s+(%d+)")) or 0
        db_udp = tonumber(ds:match("udp%s+(%d+)")) or 0
        db_other = tonumber(ds:match("other%s+(%d+)")) or 0
        
        db_total = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_db/connection_count 2>/dev/null")) or 0
        if db_total == 0 then db_total = db_tcp + db_udp + db_other end

        -- IPv4 硬件加速明细
        v4_acc = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv4/accelerated_count 2>/dev/null")) or 0
        v4_tcp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv4/tcp_accelerated_count 2>/dev/null")) or 0
        v4_udp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv4/udp_accelerated_count 2>/dev/null")) or 0
        v4_icmp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv4/non_ported_accelerated_count 2>/dev/null")) or 0

        -- IPv6 硬件加速明细
        v6_acc = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv6/accelerated_count 2>/dev/null")) or 0
        v6_tcp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv6/tcp_accelerated_count 2>/dev/null")) or 0
        v6_udp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv6/udp_accelerated_count 2>/dev/null")) or 0
        v6_icmp = tonumber(luci.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv6/non_ported_accelerated_count 2>/dev/null")) or 0
    end

    local data = {
        cpu_temp = cpu_temp,
        wifi24g = w24,
        wifi5g = w5,
        wifi_game = wg,
        ecm = {
            avail = ecm_avail,
            db_total = db_total,
            db_tcp = db_tcp,
            db_udp = db_udp,
            db_other = db_other,
            v4_acc = v4_acc,
            v4_tcp = v4_tcp,
            v4_udp = v4_udp,
            v4_icmp = v4_icmp,
            v6_acc = v6_acc,
            v6_tcp = v6_tcp,
            v6_udp = v6_udp,
            v6_icmp = v6_icmp
        }
    }

    luci.http.prepare_content("application/json")
    luci.http.write_json(data)
end
