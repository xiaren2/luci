module("luci.controller.nssinfo", package.seeall)

local function trim(s)
    return s and s:match("^%s*(.-)%s*$") or ""
end

function index()
    entry({"admin", "status", "nssinfo"},
        template("nssinfo/index"),
        _("NSS Info"), 50).dependent = false

    entry({"admin", "status", "nssinfo_data"},
        call("action_data")).dependent = false

    entry({"admin", "status", "nssinfo_stats"},
        call("action_stats")).dependent = false
end

-- Thermal + ECM 基础数据
function action_data()
    local sys = require "luci.sys"
    local http = require "luci.http"

    local thermal = {}
    local zones = sys.exec("ls -d /sys/class/thermal/thermal_zone* 2>/dev/null")
    for zone in zones:gmatch("[^\n]+") do
        local t = trim(sys.exec("cat " .. zone .. "/type 2>/dev/null"))
        local v = trim(sys.exec("cat " .. zone .. "/temp 2>/dev/null"))
        if t ~= "" and v ~= "" then
            thermal[t] = tonumber(v) / 1000
        end
    end

    local v4_acc = tonumber(trim(sys.exec(
        "cat /sys/kernel/debug/ecm/ecm_nss_ipv4/accelerated_count 2>/dev/null"))) or 0
    local db_all = tonumber(trim(sys.exec(
        "cat /sys/kernel/debug/ecm/ecm_db/connection_count 2>/dev/null"))) or 0

    http.prepare_content("application/json")
    http.write_json({
        thermal = thermal,
        ecm_accel = v4_acc,
        ecm_total = db_all
    })
end

-- CPU / 内存 / 网络 / ECM 细分
function action_stats()
    local fs = require "nixio.fs"
    local http = require "luci.http"

    -- CPU 第一次采样
    local cpu1 = fs.readfile("/proc/stat"):match("^cpu%s+(%d+)%s+(%d+)%s+(%d+)%s+(%d+)")
    local idle1 = tonumber(cpu1:match("%S+$"))
    local total1 = 0
    for n in cpu1:gmatch("%d+") do total1 = total1 + tonumber(n) end

    -- WAN 接口
    local wan = "eth0"
    for l in io.lines("/proc/net/route") do
        if l:match("^%S+%s+00000000") then
            wan = l:match("^(%S+)")
            break
        end
    end

    local rx_path = "/sys/class/net/" .. wan .. "/statistics/rx_bytes"
    local tx_path = "/sys/class/net/" .. wan .. "/statistics/tx_bytes"
    local rx1 = tonumber(fs.readfile(rx_path)) or 0
    local tx1 = tonumber(fs.readfile(tx_path)) or 0

    -- ECM 细分
    local ecm = { v4 = {}, v6 = {}, db = {} }
    local function g(f)
        return tonumber(trim(fs.readfile("/sys/kernel/debug/ecm/" .. f) or "")) or 0
    end

    ecm.v4.accel = g("ecm_nss_ipv4/accelerated_count")
    ecm.v4.tcp   = g("ecm_nss_ipv4/tcp_accelerated_count")
    ecm.v4.udp   = g("ecm_nss_ipv4/udp_accelerated_count")
    ecm.v4.icmp  = g("ecm_nss_ipv4/non_ported_accelerated_count")

    ecm.v6.accel = g("ecm_nss_ipv6/accelerated_count")
    ecm.v6.tcp   = g("ecm_nss_ipv6/tcp_accelerated_count")
    ecm.v6.udp   = g("ecm_nss_ipv6/udp_accelerated_count")
    ecm.v6.icmp  = g("ecm_nss_ipv6/non_ported_accelerated_count")

    ecm.db.total = g("ecm_db/connection_count")
    ecm.db.tcp   = tonumber(fs.readfile("/sys/kernel/debug/ecm/ecm_db/connection_count_simple"):match("tcp%s+(%d+)")) or 0
    ecm.db.udp   = tonumber(fs.readfile("/sys/kernel/debug/ecm/ecm_db/connection_count_simple"):match("udp%s+(%d+)")) or 0
    ecm.db.other = tonumber(fs.readfile("/sys/kernel/debug/ecm/ecm_db/connection_count_simple"):match("other%s+(%d+)")) or 0

    -- 间隔采样
    os.execute("sleep 1")

    local cpu2 = fs.readfile("/proc/stat"):match("^cpu%s+(%d+)%s+(%d+)%s+(%d+)%s+(%d+)")
    local idle2 = tonumber(cpu2:match("%S+$"))
    local total2 = 0
    for n in cpu2:gmatch("%d+") do total2 = total2 + tonumber(n) end

    local rx2 = tonumber(fs.readfile(rx_path)) or 0
    local tx2 = tonumber(fs.readfile(tx_path)) or 0

    local cpu_pct = 0
    if total2 - total1 > 0 then
        cpu_pct = math.floor(100 - (idle2 - idle1) * 100 / (total2 - total1))
    end

    -- 内存
    local mem = fs.readfile("/proc/meminfo")
    local mem_total = tonumber(mem:match("MemTotal:%s+(%d+)")) or 1
    local mem_avail = tonumber(mem:match("MemAvailable:%s+(%d+)")) or 0
    local mem_used = mem_total - mem_avail
    local mem_pct = math.floor(mem_used * 100 / mem_total)

    http.prepare_content("application/json")
    http.write_json({
        cpu_pct = cpu_pct,
        mem_used = mem_used,
        mem_total = mem_total,
        mem_pct = mem_pct,
        rx_speed = math.max(0, rx2 - rx1),
        tx_speed = math.max(0, tx2 - tx1),
        rx_bytes = rx2,
        tx_bytes = tx2,
        wan_if = wan,
        ecm = ecm
    })
end
