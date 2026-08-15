'use strict';
'require view';
'require ui';
'require rpc';

var captureActive = false;
var captureName = null;

var callGetStatus = rpc.declare({
	object: 'luci.tcpdump',
	method: 'getStatus',
	expect: { '': {} }
});

var callStartCapture = rpc.declare({
	object: 'luci.tcpdump',
	method: 'startCapture',
	params: [ 'ifname', 'stop_value', 'stop_unit', 'filter' ],
	expect: { '': {} }
});

var callStopCapture = rpc.declare({
	object: 'luci.tcpdump',
	method: 'stopCapture',
	expect: { '': {} }
});

var callListFiles = rpc.declare({
	object: 'luci.tcpdump',
	method: 'listFiles',
	expect: { '': {} }
});

var callDeleteFile = rpc.declare({
	object: 'luci.tcpdump',
	method: 'deleteFile',
	params: [ 'name' ],
	expect: { '': {} }
});

var callGetInterfaces = rpc.declare({
	object: 'luci.tcpdump',
	method: 'getInterfaces',
	expect: { '': { interfaces: [] } }
});

var callGetFile = rpc.declare({
	object: 'luci.tcpdump',
	method: 'getFile',
	params: [ 'type', 'name' ],
	expect: { '': {} }
});

var callNetIfDump = rpc.declare({
	object: 'network.interface',
	method: 'dump',
	expect: { '': {} }
});

function L(key, def) {
	return (typeof _ !== 'undefined') ? _(key) : (def || key);
}

function humanSize(size) {
	var units = ['B', 'KiB', 'MiB', 'GiB'];
	var idx = 0;
	while (size > 1024 && idx < 3) {
		idx++;
		size /= 1024;
	}
	return (Math.round(size * 100) / 100 + ' ' + units[idx]);
}

function humanDate(sec) {
	var d = new Date(sec * 1000);
	function pad(n) {
		return n < 10 ? '0' + n : n;
	}
	return (
		d.getFullYear() + '-' +
		pad(d.getMonth() + 1) + '-' +
		pad(d.getDate()) + ' ' +
		pad(d.getHours()) + ':' +
		pad(d.getMinutes()) + ':' +
		pad(d.getSeconds())
	);
}

return view.extend({
	load: function() {
		var self = this;
		return Promise.all([
			callGetStatus().catch(function() { return {}; }),
			callGetInterfaces().catch(function() { return { interfaces: [] }; }),
			callNetIfDump().catch(function() { return null; })
		]);
	},

	render: function(data) {
		var statusData = data[0] || {};
		var ifaceData = data[1] || { interfaces: [] };
		var netDump = data[2] || null;

		var capture = (statusData && statusData.capture) ? statusData.capture : {};
		var listData = (statusData && statusData.list) ? statusData.list : { entries: [] };

		// Merge interfaces from multiple sources, de-duplicate
		var seen = {};
		var ifaces = [];
		if (ifaceData && ifaceData.interfaces && Array.isArray(ifaceData.interfaces)) {
			for (var i = 0; i < ifaceData.interfaces.length; i++) {
				var n = ifaceData.interfaces[i];
				if (n && !seen[n]) { seen[n] = true; ifaces.push(n); }
			}
		}
		if (netDump && netDump.interface) {
			for (var k in netDump.interface) {
				var ifc = netDump.interface[k] || {};
				var d1 = ifc.device || k;
				if (d1 && !seen[d1]) { seen[d1] = true; ifaces.push(d1); }
				var d2 = ifc.l3_device;
				if (d2 && !seen[d2]) { seen[d2] = true; ifaces.push(d2); }
			}
		}
		ifaces.sort();

		captureActive = !!capture.active;
		captureName = capture.cap_name || null;

		var m = E('div', { 'class': 'cbi-map' }, [
			this.renderCaptureControl(ifaces),
			this.renderConsole(capture),
			this.renderFileList(listData)
		]);

		var self = this;
		requestAnimationFrame(function() {
			self.updateButton();
			self.updateStatus(statusData);
			self.startPolling();
		});

		return m;
	},

	renderCaptureControl: function(ifaces) {
		var ifSelect = E('select', {
			'id': 'cap_ifname',
			'class': 'cbi-input-select',
			'style': 'width:100%;'
		}, []);

		for (var i = 0; i < ifaces.length; i++) {
			ifSelect.appendChild(E('option', { 'value': ifaces[i] }, ifaces[i]));
		}
		ifSelect.appendChild(E('option', { 'value': 'any' }, L('any', '任意接口')));

		var stopValue = E('input', {
			'id': 'cap_stop_value',
			'class': 'cbi-input-text',
			'type': 'text',
			'value': '0',
			'style': 'flex:2; width:auto;'
		});
		stopValue.addEventListener('input', function(ev) {
			ev.target.value = ev.target.value.replace(/\D/g, '');
		});

		var stopUnit = E('select', {
			'id': 'cap_stop_unit',
			'class': 'cbi-input-select',
			'style': 'flex:1;'
		}, [
			E('option', { 'value': 'T' }, L('seconds', '秒')),
			E('option', { 'value': 'P' }, L('packets', '数据包'))
		]);

		var filter = E('input', {
			'id': 'cap_filter',
			'class': 'cbi-input-text',
			'type': 'text',
			'placeholder': L('e.g. tcp port 80', '例如：tcp port 80'),
			'style': 'width:100%;'
		});

		var bt = E('button', {
			'id': 'bt_capture',
			'type': 'button',
			'class': 'cbi-button cbi-button-apply',
			'style': 'width:100%; height:32px;'
		}, '');

		var self = this;
		bt.addEventListener('click', function() {
			if (!captureActive) {
				self.startCapture();
			} else {
				self.stopCapture();
			}
		});
		self.updateButton();

		return E('div', { 'class': 'cbi-section', 'id': 'cbi-tcpdump-settings' }, [
			E('div', { 'class': 'cbi-section-header' }, L('Start network capture', '启动网络抓包')),
			E('div', { 'class': 'cbi-section-node cbi-section-node-tabbed' }, [
				E('div', {
					'style': 'display:inline-block; padding:10px; min-width:220px; border:none; vertical-align:top;'
				}, [
					E('label', {
						'class': 'cbi-value-title',
						'for': 'cap_ifname',
						'style': 'float:none; width:auto; text-align:left; margin-bottom:5px; display:block;'
					}, L('Interface', '网络接口')),
					E('div', { 'class': 'cbi-value-field' }, ifSelect)
				]),
				E('div', {
					'style': 'display:inline-block; padding:10px; min-width:240px; border:none; vertical-align:top;'
				}, [
					E('label', {
						'class': 'cbi-value-title',
						'for': 'cap_stop_value',
						'style': 'float:none; width:auto; text-align:left; margin-bottom:5px; display:block;'
					}, L('Capture limit', '抓包限制')),
					E('div', { 'class': 'cbi-value-field', 'style': 'display:flex; gap:4px;' }, [
						stopValue,
						stopUnit
					])
				]),
				E('div', {
					'style': 'display:inline-block; padding:10px; min-width:260px; border:none; vertical-align:top;'
				}, [
					E('label', {
						'class': 'cbi-value-title',
						'for': 'cap_filter',
						'style': 'float:none; width:auto; text-align:left; margin-bottom:5px; display:block;'
					}, [ L('Filter', 'BPF 过滤规则'), ' (BPF)' ]),
					E('div', { 'class': 'cbi-value-field' }, filter)
				]),
				E('div', {
					'style': 'display:inline-block; padding:10px; min-width:160px; border:none; vertical-align:bottom;'
				}, [
					E('div', { 'class': 'cbi-value-field' }, bt)
				])
			])
		]);
	},

	renderConsole: function(status) {
		var statusEl = E('div', {
			'id': 'tcpdump-status',
			'style': 'display:inline-block; padding:5px 12px; border-radius:4px; font-weight:600; font-size:0.9rem;'
		}, L('Checking...', '状态检查中...'));

		var msgEl = E('div', {
			'id': 'tcpdump-message',
			'style': 'font-weight:500; margin-top:10px; font-family:monospace; white-space:pre-wrap;'
		}, '');

		var logEl = E('pre', {
			'id': 'tcpdump-log',
			'style': 'padding:12px; max-height:250px; overflow-y:auto; font-family:monospace; font-size:12px; border-radius:4px; border:1px solid rgba(128,128,128,0.15); white-space:pre-wrap; line-height:1.5;'
		}, '');

		var logContainer = E('div', {
			'id': 'tcpdump-log-container',
			'style': 'display:none; margin-top:10px;'
		}, logEl);

		return E('div', { 'class': 'cbi-section', 'id': 'cbi-tcpdump-console' }, [
			E('div', { 'class': 'cbi-section-header' }, L('Console Output', '控制台输出')),
			E('div', { 'class': 'cbi-section-node', 'style': 'padding:15px;' }, [
				E('div', {}, statusEl),
				msgEl,
				logContainer
			])
		]);
	},

	renderFileList: function(listData) {
		var entries = (listData && listData.entries) ? listData.entries : [];
		var tbody = E('tbody', { 'id': 't_list_body' }, []);
		this.populateTable(tbody, entries);

		var table = E('table', {
			'id': 't_list',
			'class': 'table cbi-section-table'
		}, [
			E('thead', {}, [
				E('tr', { 'class': 'cbi-section-table-titles' }, [
					E('th', { 'class': 'cbi-section-table-cell' }, L('Capture file', '抓包文件')),
					E('th', { 'class': 'cbi-section-table-cell' }, L('Modification date', '修改时间')),
					E('th', { 'class': 'cbi-section-table-cell' }, L('Capture size', '文件大小')),
					E('th', { 'class': 'cbi-section-table-cell', 'style': 'text-align:right;' }, L('Actions', '操作'))
				])
			]),
			tbody
		]);

		return E('div', { 'class': 'cbi-section', 'id': 'cbi-tcpdump-results' }, [
			E('div', { 'class': 'cbi-section-header' }, L('Capture files', '抓包文件列表')),
			E('div', { 'class': 'cbi-section-node' }, table)
		]);
	},

	populateTable: function(tbody, entries) {
		while (tbody.firstChild) {
			tbody.removeChild(tbody.firstChild);
		}

		if (!entries || entries.length === 0) {
			var row = E('tr', { 'class': 'cbi-section-table-row cbi-rowstyle-1' }, [
				E('td', {
					'class': 'cbi-section-table-cell',
					'colSpan': 4,
					'style': 'text-align:center;'
				}, [
					E('em', {
						'style': 'display:block; padding:16px 0; opacity:0.7; font-style:normal;'
					}, L('There are no capture files yet. Please start a capture first.', '暂无抓包文件，请先开始抓包'))
				])
			]);
			tbody.appendChild(row);
			return;
		}

		var totalSize = 0;
		var self = this;

		for (var i = 0; i < entries.length; i++) {
			(function(i) {
				var e = entries[i];
				totalSize += Number(e.size || 0);

				var actions = E('div', { 'style': 'display:flex; gap:4px; justify-content:flex-end;' }, []);

				var btPcap = E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					'click': function() { self.downloadFile('pcap', e.name); }
				}, L('PCAP', '下载 PCAP'));
				actions.appendChild(btPcap);

				var btFilter = E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					'click': function() { self.downloadFile('filter', e.name); }
				}, L('Filter', '过滤规则'));
				if (!e.filter) {
					btFilter.disabled = true;
				}
				actions.appendChild(btFilter);

				var btRemove = E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-remove',
					'click': function() { self.removeFile(e.name); }
				}, L('Remove', '删除'));
				actions.appendChild(btRemove);

				var row = E('tr', {
					'class': 'cbi-section-table-row cbi-rowstyle-' + ((i % 2) + 1)
				}, [
					E('td', { 'class': 'cbi-section-table-cell' }, [
						E('strong', {}, e.name + '.pcap')
					]),
					E('td', { 'class': 'cbi-section-table-cell' }, humanDate(e.mtime)),
					E('td', { 'class': 'cbi-section-table-cell' }, humanSize(e.size)),
					E('td', { 'class': 'cbi-section-table-cell', 'style': 'text-align:right;' }, actions)
				]);

				tbody.appendChild(row);
			})(i);
		}

		var footerActions = E('div', { 'style': 'display:flex; gap:4px; justify-content:flex-end;' }, [
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-apply',
				'click': function() { self.downloadFile('all'); }
			}, [ '\uD83D\uDCE6 ', L('Download All', '全部下载') ]),
			E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-remove',
				'click': function() { self.removeFile('all'); }
			}, L('Remove All', '删除全部'))
		]);

		var footer = E('tr', { 'class': 'cbi-section-table-row cbi-rowstyle-1' }, [
			E('td', { 'class': 'cbi-section-table-cell' }, [
				E('b', {}, L('All files', '全部文件'))
			]),
			E('td', { 'class': 'cbi-section-table-cell' }, ''),
			E('td', { 'class': 'cbi-section-table-cell' }, [
				E('b', {}, humanSize(totalSize))
			]),
			E('td', { 'class': 'cbi-section-table-cell', 'style': 'text-align:right;' }, footerActions)
		]);

		tbody.appendChild(footer);
	},

	updateButton: function() {
		var bt = document.getElementById('bt_capture');
		if (!bt) return;

		if (!captureActive) {
			bt.textContent = L('Start capture', '开始抓包');
			bt.className = 'cbi-button cbi-button-apply';
		} else {
			bt.textContent = L('Stop capture', '停止抓包');
			bt.className = 'cbi-button cbi-button-reset';
		}
		bt.disabled = false;
	},

	updateStatus: function(data) {
		var statusEl = document.getElementById('tcpdump-status');
		var msgEl = document.getElementById('tcpdump-message');
		var logContainer = document.getElementById('tcpdump-log-container');
		var logEl = document.getElementById('tcpdump-log');

		var capture = (data && data.capture) ? data.capture : {};
		var cmd = (data && data.cmd) ? data.cmd : null;

		captureActive = !!capture.active;
		captureName = capture.cap_name || null;

		if (statusEl) {
			if (captureActive) {
				statusEl.innerHTML = '\u25CF ' + L('RUNNING', '运行中');
				statusEl.style.backgroundColor = 'rgba(56,161,105,0.2)';
				statusEl.style.color = '#38a169';
			} else {
				statusEl.innerHTML = '\u25A0 ' + L('STOPPED', '已停止');
				statusEl.style.backgroundColor = 'rgba(128,128,128,0.2)';
				statusEl.style.color = 'inherit';
			}
		}

		if (msgEl) {
			var text = '';
			if (cmd && cmd.msg) {
				if (Array.isArray(cmd.msg)) {
					for (var i = 0; i < cmd.msg.length; i++) {
						text += cmd.msg[i] + '\n';
					}
				} else {
					text = String(cmd.msg);
				}
			} else if (capture) {
				text = capture.msg || '';
			}
			msgEl.textContent = text;
		}

		if (logContainer && logEl) {
			if (captureActive && capture.log) {
				logContainer.style.display = 'block';
				logEl.textContent = capture.log;
				logEl.scrollTop = logEl.scrollHeight;
			} else {
				logContainer.style.display = 'none';
				logEl.textContent = '';
			}
		}

		this.updateButton();
	},

	updateTable: function(listData) {
		var tbody = document.getElementById('t_list_body');
		if (!tbody) return;
		var entries = (listData && listData.entries) ? listData.entries : [];
		this.populateTable(tbody, entries);
	},

	updateAll: function(data) {
		this.updateStatus(data);
		if (data && data.list) {
			this.updateTable(data.list);
		} else {
			var self = this;
			callListFiles().then(function(res) {
				if (res && res.list) {
					self.updateTable(res.list);
				}
			}).catch(function() {});
		}
	},

	pollTimer: null,

	startPolling: function() {
		var self = this;
		if (self.pollTimer)
			clearInterval(self.pollTimer);
		self.pollTimer = setInterval(function() {
			Promise.all([
				callGetStatus().catch(function() { return null; }),
				callListFiles().catch(function() { return null; })
			]).then(function(results) {
				var s = results[0];
				var l = results[1];
				if (s) self.updateStatus(s);
				if (l && l.list) self.updateTable(l.list);
			});
		}, 5000);
	},

	startCapture: function() {
		var ifname = document.getElementById('cap_ifname').value;
		var stop_value = document.getElementById('cap_stop_value').value || '0';
		var stop_unit = document.getElementById('cap_stop_unit').value;
		var filter = document.getElementById('cap_filter').value || '';

		var self = this;
		callStartCapture(ifname, stop_value, stop_unit, filter).then(function(res) {
			self.updateAll(res);
			if (res && res.cmd && res.cmd.ok === false) {
				var msg = (res.cmd.msg && res.cmd.msg.join) ? res.cmd.msg.join('\n') : String(res.cmd.msg || 'Error');
				ui.addNotification(null, E('p', {}, msg), 'error');
			}
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, 'RPC Error: ' + (err.message || err)), 'error');
		});
	},

	stopCapture: function() {
		var self = this;
		callStopCapture().then(function(res) {
			self.updateAll(res);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, 'RPC Error: ' + (err.message || err)), 'error');
		});
	},

	downloadFile: function(type, capName) {
		var self = this;
		callGetFile(type, capName || '').then(function(res) {
			if (!res || res.ok === false) {
				ui.addNotification(null, E('p', {}, res && res.error ? res.error : 'Download failed'), 'error');
				return;
			}
			// base64 → Blob → 下载
			var byteChars = atob(res.data);
			var byteArray = new Uint8Array(byteChars.length);
			for (var i = 0; i < byteChars.length; i++) {
				byteArray[i] = byteChars.charCodeAt(i);
			}
			var blob = new Blob([byteArray], { type: res.mime || 'application/octet-stream' });
			var url = URL.createObjectURL(blob);
			var a = document.createElement('a');
			a.href = url;
			a.download = res.filename || (type === 'all' ? 'captures.tar' : (capName + '.' + type));
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, 'RPC Error: ' + (err.message || err)), 'error');
		});
	},

	removeFile: function(capName) {
		if (capName === 'all') {
			if (!confirm(L('Are you sure you want to delete all files?', '确定要删除全部抓包文件吗？'))) {
				return;
			}
		}

		var self = this;
		callDeleteFile(capName).then(function(res) {
			self.updateAll(res);
		}).catch(function(err) {
			ui.addNotification(null, E('p', {}, 'RPC Error: ' + (err.message || err)), 'error');
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
