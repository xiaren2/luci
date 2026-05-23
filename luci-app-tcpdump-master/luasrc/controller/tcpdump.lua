```lua
module("luci.controller.tcpdump", package.seeall)

tcpdump_root_folder = "/tmp/tcpdump/"
tcpdump_cap_folder = tcpdump_root_folder .. "cap/"
tcpdump_filter_folder = tcpdump_root_folder .. "filter/"
pid_file = tcpdump_root_folder .. "tcpdump.pid"
log_file = tcpdump_root_folder .. "tcpdump.log"
out_file = tcpdump_root_folder .. "tcpdump.out"
sleep_file = tcpdump_root_folder .. "tcpdump.sleep"

function index()

	entry(
		{"admin", "network", "tcpdump"},
		template("tcpdump"),
		_("Tcpdump"),
		70
	).dependent = false

	page = entry(
		{"admin", "network", "tcpdump", "capture_start"},
		call("capture_start"),
		nil
	)

	page.leaf = true

	page = entry(
		{"admin", "network", "tcpdump", "capture_stop"},
		call("capture_stop"),
		nil
	)

	page.leaf = true

	page = entry(
		{"admin", "network", "tcpdump", "update"},
		call("update"),
		nil
	)

	page.leaf = true

	page = entry(
		{"admin", "network", "tcpdump", "capture_get"},
		call("capture_get"),
		nil
	)

	page.leaf = true

	page = entry(
		{"admin", "network", "tcpdump", "capture_remove"},
		call("capture_remove"),
		nil
	)

	page.leaf = true
end

function param_check(ifname, stop_value, stop_unit, filter)

	local check = false
	local message = {}

	if ifname == nil or ifname == "" then
		table.insert(message, "Interface name is null or blank.")
	end

	local nixio = require "nixio"

	for k, v in ipairs(nixio.getifaddrs()) do

		if v.family == "packet" then

			if ifname == v.name then
				check = true
				break
			end
		end
	end

	if ifname == "any" then
		check = true
	end

	if not check then
		table.insert(message, "Interface does not exist or is not valid.")
	end

	if tonumber(stop_value) == nil then
		check = false
		table.insert(message, "Capture length parameter must be a number.")
	end

	if stop_unit == nil then

		check = false

		table.insert(message, "Capture unit is null or blank.")

	else

		stop_unit = string.upper(stop_unit)

		if stop_unit ~= "T" and stop_unit ~= "P" then

			check = false

			table.insert(
				message,
				"Capture unit must be Time(T) or packet(P)."
			)
		end
	end

	return check, message
end

function capture_start(ifname, stop_value, stop_unit, filter)

	local active, pid = capture_active()

	local res = {}
	local cmd = {}

	if active then

		cmd["ok"] = false
		cmd["msg"] = {"Previous capture is still ongoing!"}

	else

		local check, msg =
			param_check(ifname, stop_value, stop_unit, filter)

		if not check then

			cmd["ok"] = false
			cmd["msg"] = msg

		else

			os.execute("mkdir -p " .. tcpdump_cap_folder)
			os.execute("mkdir -p " .. tcpdump_filter_folder)

			local prefix =
				"capture_" .. os.date("%Y-%m-%d_%H.%M.%S")

			local pcap_file =
				tcpdump_cap_folder .. prefix .. ".pcap"

			local filter_file =
				tcpdump_filter_folder .. prefix .. ".filter"

			string_to_file(filter_file, filter)
			string_to_file(out_file, prefix)

			tcpdump_start(
				ifname,
				stop_value,
				stop_unit,
				filter_file,
				pcap_file
			)

			res["filter"] = filter

			cmd["ok"] = true
			cmd["msg"] = {"Capture in progress.."}
		end
	end

	res["cmd"] = cmd
	res["capture"] = capture()
	res["list"] = list()

	luci.http.prepare_content("application/json")
	luci.http.write_json(res)
end

function string_to_file(file, data)

	if data == nil then
		data = ""
	end

	local f = io.open(file, "w")

	f:write(data)

	f:close()
end

function tcpdump_start(
	ifname,
	stop_value,
	stop_unit,
	filter_file,
	pcap_file
)

	local cmd = "tcpdump -i %s -F %s -w %s"

	cmd = string.format(
		cmd,
		ifname,
		filter_file,
		pcap_file
	)

	if tonumber(stop_value) ~= 0 and stop_unit == "P" then
		cmd = cmd .. " -c " .. stop_value
	end

	cmd = string.format(
		"(%s > %s 2>&1 &) ; echo $! > %s",
		cmd,
		log_file,
		pid_file
	)

	os.execute(cmd)

	if tonumber(stop_value) ~= 0 and stop_unit == "T" then

		local f = io.open(pid_file, "r")

		if f ~= nil then

			local pid = f:read()

			f:close()

			local t_out =
				string.format(
					"(sleep %s && kill %s) >/dev/null 2>&1 & echo $! > %s",
					stop_value,
					pid,
					sleep_file
				)

			os.execute(t_out)
		end
	end
end

function capture_stop()

	local res = {}
	local cmd = {}

	local _, active, pid = capture()

	if active then

		luci.sys.process.signal(pid, 9)

		cmd["ok"] = true
		cmd["msg"] = {"Capture has been terminated"}

	else

		cmd["ok"] = false
		cmd["msg"] = {"There was not active capture!"}
	end

	capture_cleanup()

	res["cmd"] = cmd
	res["capture"] = capture()
	res["list"] = list()

	luci.http.prepare_content("application/json")
	luci.http.write_json(res)
end

function capture_active()

	local f = io.open(pid_file, "r")

	if f ~= nil then

		pid = f:read()

		f:close()

		if tonumber(pid) ~= nil and
			luci.sys.process.signal(pid, 0) then

			return true, pid
		end
	end

	return false, nil
end

function capture_log()

	local log

	local f = io.open(log_file, "r")

	if f ~= nil then

		log = f:read("*all")

		f:close()

	else
		log = ""
	end

	return log
end

function capture_name()

	local cap_name = nil

	local f = io.open(out_file, "r")

	if f ~= nil then

		cap_name = f:read()

		f:close()
	end

	return cap_name
end

function capture()

	local fs = require "nixio.fs"

	local res = {}

	local active, pid = capture_active()

	res["active"] = active
	res["log"] = capture_log()

	if active then

		res["msg"] = "Capture in progress.."
		res["cap_name"] = capture_name()

	elseif fs.access(pid_file) then

		capture_cleanup()

		res["msg"] =
			"Process seems to be dead, removing pid file!"

	else

		res["msg"] = "No capture in progress"
	end

	return res, active, pid
end

function capture_cleanup()

	os.remove(pid_file)
	os.remove(log_file)
	os.remove(out_file)

	local f = io.open(sleep_file, "r")

	if f ~= nil then

		pid = f:read()

		f:close()

		if tonumber(pid) ~= nil and
			luci.sys.process.signal(pid, 0) then

			luci.sys.process.signal(pid, 9)
		end
	end

	os.remove(sleep_file)
end

function list_entries(cap_name)

	local fs = require "nixio.fs"

	local entries = {}

	local glob_str

	if cap_name == nil then
		glob_str = tcpdump_cap_folder .. "*.pcap"
	else
		glob_str = tcpdump_cap_folder .. cap_name .. ".pcap"
	end

	for file in fs.glob(glob_str) do

		local name = string.sub(fs.basename(file), 1, -6)

		local size = fs.stat(file, "size")

		local mtime = fs.stat(file, "ctime")

		local filter = false

		if fs.access(
			tcpdump_filter_folder .. name .. ".filter"
		) then
			filter = true
		end

		table.insert(entries, {
			name = name,
			size = size,
			mtime = mtime,
			filter = filter
		})
	end

	return entries
end

function list(cap_name)

	local res = {}

	res["entries"] = list_entries(cap_name)
	res["update"] = (cap_name ~= nil)

	return res
end

function update(cap_name)

	local res = {}
	local cmd = {}

	cmd["ok"] = true

	res["cmd"] = cmd
	res["capture"] = capture()
	res["list"] = list(cap_name)

	luci.http.prepare_content("application/json")
	luci.http.write_json(res)
end

function pump_file(file, mime_str)

	local nixio = require "nixio"

	local fh = io.open(file)

	if not fh then
		luci.http.status(404, "File not found")
		return
	end

	local reader = luci.ltn12.source.file(fh)

	luci.http.header(
		"Content-Disposition",
		'attachment; filename="' ..
			nixio.fs.basename(file) .. '"'
	)

	if mime_str ~= nil then
		luci.http.prepare_content(mime_str)
	else
		luci.http.prepare_content("application/octet-stream")
	end

	luci.ltn12.pump.all(reader, luci.http.write)

	fh:close()
end

function capture_get()

	local nixio = require "nixio"

	local path = luci.http.getenv("PATH_INFO") or ""

	local file_type =
		path:match("/capture_get/([^/]+)")

	local cap_name =
		path:match("/capture_get/[^/]+/(.+)")

	if file_type == "all" then

		local system =
			require "luci.controller.admin.system"

		local tar_captures_cmd =
			"tar -c " ..
			tcpdump_cap_folder ..
			"*.pcap 2>/dev/null"

		local reader =
			system.ltn12_popen(tar_captures_cmd)

		luci.http.header(
			"Content-Disposition",
			string.format(
				'attachment; filename="captures-%s.tar"',
				os.date("%Y-%m-%d_%H.%M.%S")
			)
		)

		luci.http.prepare_content("application/x-tar")

		luci.ltn12.pump.all(reader, luci.http.write)

	elseif file_type == "pcap" and cap_name then

		local file =
			tcpdump_cap_folder ..
			cap_name ..
			".pcap"

		if nixio.fs.access(file) then
			pump_file(file)
		else
			luci.http.status(404, "File not found")
		end

	elseif file_type == "filter" and cap_name then

		local file =
			tcpdump_filter_folder ..
			cap_name ..
			".filter"

		if nixio.fs.access(file) then
			pump_file(file, "text/plain")
		else
			luci.http.status(404, "File not found")
		end

	else

		luci.http.status(400, "Bad request")
	end
end

function capture_remove()

	local path = luci.http.getenv("PATH_INFO") or ""

	local cap_name =
		path:match("/capture_remove/(.+)")

	if not cap_name then
		luci.http.status(400, "Bad request")
		return
	end

	if cap_name == "all" then

		local fs = require "nixio.fs"

		for file in fs.glob(
			tcpdump_cap_folder .. "*.pcap"
		) do
			os.remove(file)
		end

		for file in fs.glob(
			tcpdump_filter_folder .. "*.filter"
		) do
			os.remove(file)
		end

	else

		os.remove(
			tcpdump_cap_folder ..
				cap_name ..
				".pcap"
		)

		os.remove(
			tcpdump_filter_folder ..
				cap_name ..
				".filter"
		)
	end

	update()
end
```
