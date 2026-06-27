module("luci.controller.nssinfo", package.seeall)

function index()
    entry({"admin", "status", "nssinfo"}, template("nssinfo/index"), _("NSS Info"), 50).dependent = false
    -- 增加一个用于异步刷新的数据接口
    entry({"admin", "status", "nssinfo_data"}, call("action_data")).dependent = false
end

function action_data()
    local sys = require "luci.sys"
    local luci = require "luci.http"
    
    -- 1. 采集温度
    local thermal = {}
    local zones = sys.exec("ls -d /sys/class/thermal/thermal_zone* 2>/dev/null")
    for zone in zones:gmatch("[^\n]+") do
        local type_str = sys.exec("cat " .. zone .. "/type 2>/dev/null"):trim()
        local temp_str = sys.exec("cat " .. zone .. "/temp 2>/dev/null"):trim()
        if type_str ~= "" and temp_str ~= "" then
            local temp_num = tonumber(temp_str) or 0
            thermal[type_str] = string.format("%.1f°C", temp_num / 1000)
        end
    end

    -- 2. 采集 ECM 计数器
    local ecm_accel = sys.exec("cat /sys/kernel/debug/ecm/ecm_nss_ipv4/accelerated_count 2>/dev/null"):trim()
    local ecm_total = sys.exec("cat /sys/kernel/debug/ecm/ecm_db/connection_count 2>/dev/null"):trim()

    luci.prepare_content("application/json")
    luci.write_json({
        thermal = thermal,
        ecm_accel = tonumber(ecm_accel) or 0,
        ecm_total = tonumber(ecm_total) or 0
    })
end
