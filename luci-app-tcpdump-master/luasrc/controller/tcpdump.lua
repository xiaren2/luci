--[[
LuCI - Tcpdump Controller (Stable Edition)
Updated: 2025-01-15
Target: OpenWrt 24.10
Fixes:
  - No blocking os.execute
  - No sleep/kill from LuCI
  - No uhttpd crash
  - Log size limited
]]

module("luci.controller.tcpdump", package.seeall)

local tcpdump_root = "/tmp/tcpdump"
local cap_dir      = tcpdump_root .. "/cap/"
local filter_dir   = tcpdump_root .. "/filter/"
local pid_file     = tcpdump_root .. "/tcpdump.pid"
local log_file     = tcpdump_root .. "/tcpdump.log"
local name_file    = tcpdump_root .. "/tcpdump.name"

function index()
    entry({"admin", "network", "tcpdump"},
          template("tcpdump"), _("Tcpdump"), 70).dependent = false

    entry({"admin", "network", "tcpdump", "capture_start"}, call("capture_start"), nil).leaf = true
    entry({"admin", "network", "tcpdump", "capture_stop"},  call("capture_stop"),  nil).leaf = true
    entry({"admin", "network", "tcpdump", "update"},        call("update"),        nil).leaf = true
    entry({"admin", "network", "tcpdump", "capture_get"},   call("capture_get"),   nil).leaf = true
    entry({"admin", "network", "tcpdump", "capture_remove"}, call("capture_remove"),nil).leaf = true
end

-- ========== Utility ==========

local function mkdir_p(path)
    os.execute("mkdir -p " .. path)
end

local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local d = f:read("*a")
    f:close()
    return d
end

local function write_file(path, data)
    local f = io.open(path, "w")
    if f then
        f:write(data or "")
        f:close()
    end
end

local function pid_alive(pid)
    return pid and tonumber(pid) and luci.sys.process.signal(pid, 0)
end

-- ========== Capture State ==========

local function capture_active()
    local pid = read_file(pid_file)
    if pid and pid_alive(pid) then
        return true, pid
    end
    return false, nil
end

local function capture_log()
    local f = io.open(log_file, "r")
    if not f then return "" end
    f:seek("end", -8192)
    local log = f:read("*a") or ""
    f:close()
    return log
end

-- ========== Param Check ==========

local function param_check(ifname, stop_value, stop_unit, filter)
    local errs = {}

    if not ifname or ifname == "" then
        table.insert(errs, "Interface is empty")
    end

    if ifname ~= "any" then
        local found = false
        local nixio = require "nixio"
        for _, v in ipairs(nixio.getifaddrs()) do
            if v.family == "packet" and v.name == ifname then
                found = true
                break
            end
        end
        if not found then
            table.insert(errs, "Interface does not exist")
        end
    end

    stop_value = tonumber(stop_value)
    if not stop_value then
        table.insert(errs, "Stop value must be a number")
    end

    if stop_unit ~= "T" and stop_unit ~= "P" then
        table.insert(errs, "Stop unit must be T or P")
    end

    return #errs == 0, errs
end

-- ========== Start Capture ==========

function capture_start(ifname, stop_value, stop_unit, filter)
    local res = {}
    local active, _ = capture_active()

    if active then
        res.cmd = { ok = false, msg = { "Capture already running" } }
        luci.http.write_json(res)
        return
    end

    local ok, errs = param_check(ifname, stop_value, stop_unit, filter)
    if not ok then
        res.cmd = { ok = false, msg = errs }
        luci.http.write_json(res)
        return
    end

    mkdir_p(cap_dir)
    mkdir_p(filter_dir)

    local name = "capture_" .. os.date("%Y-%m-%d_%H.%M.%S")
    local pcap = cap_dir .. name .. ".pcap"
    local flt  = filter_dir .. name .. ".filter"

    write_file(flt, filter or "")
    write_file(name_file, name)

    local cmd = {
        "tcpdump",
        "-i", ifname,
        "-Z", "nobody",
        "-w", pcap
    }

    if filter and filter ~= "" then
        table.insert(cmd, "-F")
        table.insert(cmd, flt)
    end

    if tonumber(stop_value) > 0 then
        if stop_unit == "P" then
            table.insert(cmd, "-c")
            table.insert(cmd, stop_value)
        elseif stop_unit == "T" then
            table.insert(cmd, "-G")
            table.insert(cmd, stop_value)
            table.insert(cmd, "-W")
            table.insert(cmd, "1")
        end
    end

    local shell = table.concat(cmd, " ")
    shell = string.format(
        "nohup %s >%s 2>&1 </dev/null & echo $! > %s",
        shell, log_file, pid_file
    )

    os.execute(shell)

    res.cmd = { ok = true, msg = { "Capture started" } }
    luci.http.write_json(res)
end

-- ========== Stop Capture ==========

function capture_stop()
    local res = {}
    local active, pid = capture_active()

    if active then
        luci.sys.process.signal(pid, 9)
        os.remove(pid_file)
        res.cmd = { ok = true, msg = { "Capture stopped" } }
    else
        res.cmd = { ok = false, msg = { "No capture running" } }
    end

    luci.http.write_json(res)
end

-- ========== Update ==========

function update()
    local res = {}
    local active, pid = capture_active()

    res.capture = {
        active = active,
        log = capture_log(),
        cap_name = read_file(name_file)
    }

    res.list = {
        entries = list_entries()
    }

    luci.http.write_json(res)
end

-- ========== File List ==========

local function list_entries()
    local fs = require "nixio.fs"
    local list = {}

    for file in fs.glob(cap_dir .. "*.pcap") do
        local name = fs.basename(file):gsub("%.pcap$", "")
        local stat = fs.stat(file)
        table.insert(list, {
            name  = name,
            size  = stat and stat.size or 0,
            mtime = stat and stat.mtime or 0,
            filter = fs.access(filter_dir .. name .. ".filter")
        })
    end

    return list
end

-- ========== Download ==========

function capture_get(file_type, cap_name)
    local http = luci.http
    local fs = require "nixio.fs"

    if file_type == "pcap" then
        local file = cap_dir .. cap_name .. ".pcap"
        if fs.access(file) then
            http.header("Content-Disposition", 'attachment; filename="' .. cap_name .. '.pcap"')
            http.prepare_content("application/vnd.tcpdump.pcap")
            http.write(fs.readfile(file))
        else
            http.status(404)
        end

    elseif file_type == "filter" then
        local file = filter_dir .. cap_name .. ".filter"
        if fs.access(file) then
            http.header("Content-Disposition", 'attachment; filename="' .. cap_name .. '.filter.txt"')
            http.prepare_content("text/plain")
            http.write(fs.readfile(file))
        else
            http.status(404)
        end

    elseif file_type == "all" then
        local tar = "/tmp/tcpdump-all.tar"
        os.execute("tar -cf " .. tar .. " -C " .. cap_dir .. " . 2>/dev/null")
        http.header("Content-Disposition", 'attachment; filename="captures.tar"')
        http.prepare_content("application/x-tar")
        http.write(fs.readfile(tar))
        os.remove(tar)
    end
end

-- ========== Remove ==========

function capture_remove(cap_name)
    if cap_name == "all" then
        os.execute("rm -f " .. cap_dir .. "* " .. filter_dir .. "*")
    else
        os.remove(cap_dir .. cap_name .. ".pcap")
        os.remove(filter_dir .. cap_name .. ".filter")
    end
    update()
end
