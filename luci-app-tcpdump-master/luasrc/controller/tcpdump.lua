--[[
LuCI Tcpdump - Minimal Stable Version
For OpenWrt 24.10
NO LOG / NO BLOCK / NO CRASH
]]

module("luci.controller.tcpdump", package.seeall)

local cap_dir   = "/tmp/tcpdump/cap/"
local pid_file   = "/tmp/tcpdump/tcpdump.pid"
local name_file  = "/tmp/tcpdump/last_capture"

function index()
    entry({"admin", "network", "tcpdump"},
          template("tcpdump"), _("Tcpdump"), 70).dependent = false

    entry({"admin", "network", "tcpdump", "start"},  call("action_start"), nil).leaf = true
    entry({"admin", "network", "tcpdump", "stop"},   call("action_stop"),  nil).leaf = true
    entry({"admin", "network", "tcpdump", "status"}, call("action_status"), nil).leaf = true
    entry({"admin", "network", "tcpdump", "list"},   call("action_list"),   nil).leaf = true
    entry({"admin", "network", "tcpdump", "remove"}, call("action_remove"), nil).leaf = true
    entry({"admin", "network", "tcpdump", "get"},    call("action_get"),    nil).leaf = true
end

-- ====== utils ======

local function sh(cmd)
    os.execute("mkdir -p /tmp/tcpdump/cap")
    os.execute(cmd .. " 2>/dev/null")
end

local function pid_alive(pid)
    return pid and luci.sys.process.signal(pid, 0)
end

local function get_pid()
    local f = io.open(pid_file)
    if not f then return nil end
    local p = f:read("*n")
    f:close()
    return p
end

-- ====== actions ======

function action_start()
    local iface  = luci.http.formvalue("ifname")
    local count  = luci.http.formvalue("count")
    local filter = luci.http.formvalue("filter")

    if pid_alive(get_pid()) then
        luci.http.write_json({ ok = false, msg = "Capture already running" })
        return
    end

    local name = "capture_" .. os.date("%Y%m%d_%H%M%S")
    local file = cap_dir .. name .. ".pcap"

    local cmd = { "tcpdump", "-i", iface, "-Z", "nobody", "-w", file }

    if count and tonumber(count) > 0 then
        table.insert(cmd, "-c")
        table.insert(cmd, count)
    end

    if filter and filter ~= "" then
        local f = io.open("/tmp/tcpdump/" .. name .. ".filter", "w")
        f:write(filter)
        f:close()
        table.insert(cmd, "-F")
        table.insert(cmd, "/tmp/tcpdump/" .. name .. ".filter")
    end

    local shell = table.concat(cmd, " ")
    shell = string.format("nohup %s >/dev/null 2>&1 </dev/null & echo $! > %s", shell, pid_file)

    sh(shell)
    sh("echo " .. name .. " > " .. name_file)

    luci.http.write_json({ ok = true, msg = "Capture started" })
end

function action_stop()
    local pid = get_pid()
    if pid then
        luci.sys.process.signal(pid, 9)
        os.remove(pid_file)
    end
    luci.http.write_json({ ok = true, msg = "Capture stopped" })
end

function action_status()
    luci.http.write_json({
        active = pid_alive(get_pid())
    })
end

function action_list()
    local fs = require "nixio.fs"
    local list = {}

    for f in fs.glob(cap_dir .. "*.pcap") do
        local st = fs.stat(f)
        table.insert(list, {
            name = fs.basename(f):gsub("%.pcap$", ""),
            size = st and st.size or 0
        })
    end

    luci.http.write_json(list)
end

function action_remove()
    local name = luci.http.formvalue("name")
    if name == "all" then
        os.execute("rm -f " .. cap_dir .. "*")
    else
        os.execute("rm -f " .. cap_dir .. name .. ".pcap")
        os.execute("rm -f /tmp/tcpdump/" .. name .. ".filter")
    end
    action_list()
end

function action_get()
    local typ = luci.http.formvalue("type")
    local name = luci.http.formvalue("name")
    local http = luci.http

    if typ == "pcap" then
        local file = cap_dir .. name .. ".pcap"
        http.header("Content-Disposition", 'attachment; filename="' .. name .. '.pcap"')
        http.prepare_content("application/octet-stream")
        http.write(io.open(file):read("*a"))
    end
end
