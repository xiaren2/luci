module("luci.controller.tcpdump", package.seeall)

local nixio = require "nixio"
local fs = require "nixio.fs"
local http = require "luci.http"
local sys = require "luci.sys"

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

	entry(
		{"admin", "network", "tcpdump", "capture_start"},
		call("capture_start")
	).leaf = true

	entry(
		{"admin", "network", "tcpdump", "capture_stop"},
		call("capture_stop")
	).leaf = true

	entry(
		{"admin", "network", "tcpdump", "update"},
		call("update")
	).leaf = true

	entry(
		{"admin", "network", "tcpdump", "capture_get"},
		call("capture_get")
	).leaf = true

	entry(
		{"admin", "network", "tcpdump", "capture_remove"},
		call("capture_remove")
	).leaf = true
end

function param_check(ifname, stop_value, stop_unit, filter)

	local ok = false
	local message = {}

	if not ifname or ifname == "" then
		table.insert(message, "Interface name is null or blank.")
	end

	for _, v in ipairs(nixio.getifaddrs()) do

		if v.family == "packet" then

			if ifname == v.name then
				ok = true
				break
			end
		end
	end

	if ifname == "any" then
		ok = true
	end

	if not ok then
		table.insert(message,
			"Interface does not exist or is not valid.")
	end

	if tonumber(stop_value) == nil then
		ok = false

		table.insert(message,
			"Capture length parameter must be a number.")
	end

	if not stop_unit then

		ok = false

		table.insert(message,
			"Capture unit is null or blank.")
	else

		stop_unit = string.upper(stop_unit)

		if stop_unit ~= "T" and stop_unit ~= "P" then

			ok = false

			table.insert(message,
				"Capture unit must be Time(T) or packet(P).")
		end
	end

	return ok, message
end

function string_to_file(file, data)

	if not data then
		data = ""
	end

	local f = io.open(file, "w")

	if f then
		f:write(data)
		f:close()
	end
end

function tcpdump_start(ifname, stop_value, stop_unit,
	filter_file, pcap_file)

	local cmd = "tcpdump -i '%s' -F '%s' -w '%s'"

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
		"( %s > '%s' 2>&1 ) & echo $! > '%s'",
		cmd,
		log_file,
		pid_file
	)

	os.execute(cmd)

	if tonumber(stop_value) ~= 0 and stop_unit == "T" then

		local f = io.open(pid_file, "r")

		if f then

			local pid = f:read("*l")
			f:close()

			if pid and pid ~= "" then

				local sleep_cmd = string.format(
					"( sleep %s; kill -9 %s ) >/dev/null 2>&1 & echo $! > '%s'",
					stop_value,
					pid,
					sleep_file
				)

				os.execute(sleep_cmd)
			end
		end
	end
end

function capture_active()

	local f = io.open(pid_file, "r")

	if f then

		local pid = f:read("*l")
		f:close()

		if tonumber(pid)
			and sys.process.signal(pid, 0) then

			return true, pid
		end
	end

	return false, nil
end

function capture_log()

	local f = io.open(log_file, "r")

	if f then

		local log = f:read("*all")
		f:close()

		return log or ""
	end

	return ""
end

function capture_name()

	local f = io.open(out_file, "r")

	if f then

		local cap_name = f:read("*l")
		f:close()

		return cap_name
	end

	return nil
end

function capture_cleanup()

	os.remove(pid_file)
	os.remove(log_file)
	os.remove(out_file)

	local f = io.open(sleep_file, "r")

	if f then

		local pid = f:read("*l")
		f:close()

		if tonumber(pid)
			and sys.process.signal(pid, 0) then

			sys.process.signal(pid, 9)
		end
	end

	os.remove(sleep_file)
end

function capture()

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

function capture_start(ifname,
	stop_value,
	stop_unit,
	filter)

	local active = capture_active()

	local res = {}
	local cmd = {}

	if active then

		cmd["ok"] = false
		cmd["msg"] = {
			"Previous capture is still ongoing!"
		}

	else

		local check, msg =
			param_check(
				ifname,
				stop_value,
				stop_unit,
				filter
			)

		if not check then

			cmd["ok"] = false
			cmd["msg"] = msg

		else

			os.execute(
				"mkdir -p '" ..
				tcpdump_cap_folder ..
				"'"
			)

			os.execute(
				"mkdir -p '" ..
				tcpdump_filter_folder ..
				"'"
			)

			local prefix =
				"capture_" ..
				os.date("%Y-%m-%d_%H.%M.%S")

			local pcap_file =
				tcpdump_cap_folder ..
				prefix ..
				".pcap"

			local filter_file =
				tcpdump_filter_folder ..
				prefix ..
				".filter"

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
			cmd["msg"] = {
				"Capture in progress.."
			}
		end
	end

	res["cmd"] = cmd
	res["capture"] = capture()
	res["list"] = list()

	http.prepare_content("application/json")
	http.write_json(res)
end

function capture_stop()

	local res = {}
	local cmd = {}

	local _, active, pid = capture()

	if active then

		sys.process.signal(pid, 9)

		cmd["ok"] = true
		cmd["msg"] = {
			"Capture has been terminated"
		}

	else

		cmd["ok"] = false
		cmd["msg"] = {
			"There was not active capture!"
		}
	end

	capture_cleanup()

	res["cmd"] = cmd
	res["capture"] = capture()
	res["list"] = list()

	http.prepare_content("application/json")
	http.write_json(res)
end

function list_entries(cap_name)

	local entries = {}
	local glob_str

	if not cap_name then
		glob_str = tcpdump_cap_folder .. "*.pcap"
	else
		glob_str = tcpdump_cap_folder ..
			cap_name ..
			".pcap"
	end

	for file in fs.glob(glob_str) do

		local name =
			string.sub(
				fs.basename(file),
				1,
				-6
			)

		local size =
			fs.stat(file, "size") or 0

		local mtime =
			fs.stat(file, "mtime") or 0

		local filter =
			fs.access(
				tcpdump_filter_folder ..
				name ..
				".filter"
			)

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

	return {
		entries = list_entries(cap_name),
		update = (cap_name ~= nil)
	}
end

function update(cap_name)

	local res = {}

	res["cmd"] = {
		ok = true
	}

	res["capture"] = capture()
	res["list"] = list(cap_name)

	http.prepare_content("application/json")
	http.write_json(res)
end

function pump_file(file, mime)

	if not fs.access(file) then

		http.status(404, "Not Found")
		http.write("File not found")

		return
	end

	local fp = io.open(file, "rb")

	if not fp then

		http.status(500,
			"Internal Server Error")

		http.write("Unable to open file")

		return
	end

	http.header(
		"Content-Disposition",
		'attachment; filename="' ..
		fs.basename(file) ..
		'"'
	)

	http.prepare_content(
		mime or "application/octet-stream"
	)

	while true do

		local chunk = fp:read(4096)

		if not chunk then
			break
		end

		http.write(chunk)
	end

	fp:close()
end

function capture_get(file_type, cap_name)

	if file_type == "all" then

		local tar_file =
			"/tmp/captures-" ..
			os.date("%Y-%m-%d_%H.%M.%S") ..
			".tar"

		os.execute(string.format(
			"tar -cf '%s' -C '%s' . >/dev/null 2>&1",
			tar_file,
			tcpdump_cap_folder
		))

		pump_file(
			tar_file,
			"application/x-tar"
		)

		os.remove(tar_file)

	elseif file_type == "pcap" then

		local file =
			tcpdump_cap_folder ..
			cap_name ..
			".pcap"

		pump_file(
			file,
			"application/octet-stream"
		)

	elseif file_type == "filter" then

		local file =
			tcpdump_filter_folder ..
			cap_name ..
			".filter"

		pump_file(
			file,
			"text/plain"
		)

	else

		http.status(400, "Bad Request")
		http.write("Invalid file type")
	end
end

function capture_remove(cap_name)

	if cap_name == "all" then

		for file in fs.glob(
			tcpdump_cap_folder ..
			"*.pcap"
		) do
			os.remove(file)
		end

		for file in fs.glob(
			tcpdump_filter_folder ..
			"*.filter"
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
