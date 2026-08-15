'use strict';

var view = require('view');
var fs   = require('luci.fs');

var capture_active = false;
var pollTimer = null;

return view.extend({

    load_ifaces: function() {
        return fs.exec_direct('ls', ['/sys/class/net']).then(function(ifaces) {
            var items = ifaces.split('\n');
            var result = [];
            for (var i = 0; i < items.length; i++) {
                var name = items[i].trim();
                if (name) result.push(name);
            }
            return result;
        }).catch(function() {
            return [];
        });
    },

    render: function() {
        var self = this;

        function update_button(active) {
            var bt = document.getElementById('bt_capture');
            if (!bt) return;
            if (!active) {
                bt.textContent = _('Start capture');
                bt.className = 'cbi-button cbi-button-apply';
            } else {
                bt.textContent = _('Stop capture');
                bt.className = 'cbi-button cbi-button-reset';
            }
            bt.disabled = false;
        }

        function human_size(size) {
            var units = ['B', 'KiB', 'MiB', 'GiB'];
            var idx = 0;
            while (size > 1024 && idx < 3) { idx++; size /= 1024; }
            return (Math.round(size * 100) / 100) + ' ' + units[idx];
        }

        function human_date(sec) {
            var d = new Date(sec * 1000);
            function pad(n) { return (n < 10) ? '0' + n : n; }
            return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' +
                pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' +
                pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        }

        function render_table(entries) {
            var tbody = document.getElementById('t_list_body');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (!entries || entries.length === 0) {
                var row = tbody.insertRow();
                row.className = 'cbi-section-table-row cbi-rowstyle-1';
                var cell = row.insertCell(0);
                cell.colSpan = 4;
                cell.className = 'cbi-section-table-cell';
                cell.style.textAlign = 'center';
                cell.innerHTML = '<em style="display:block;padding:16px 0;opacity:0.7;font-style:normal;">' +
                    _('There are no capture files yet. Please start a capture first.') + '</em>';
                return;
            }

            var total_size = 0;
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i];
                total_size += Number(e.size || 0);

                var row = tbody.insertRow();
                row.className = 'cbi-section-table-row cbi-rowstyle-' + ((i % 2) + 1);

                var c1 = row.insertCell();
                c1.className = 'cbi-section-table-cell';
                c1.innerHTML = '<strong>' + e.name + '.pcap</strong>';

                var c2 = row.insertCell();
                c2.className = 'cbi-section-table-cell';
                c2.textContent = human_date(e.mtime);

                var c3 = row.insertCell();
                c3.className = 'cbi-section-table-cell';
                c3.textContent = human_size(e.size);

                var c4 = row.insertCell();
                c4.className = 'cbi-section-table-cell';
                c4.style.textAlign = 'right';

                var html = '<div style="display:flex;gap:4px;justify-content:flex-end;">';
                html += '<button type="button" class="cbi-button cbi-button-apply" ' +
                    'data-action="get" data-type="pcap" data-name="' + e.name + '">' +
                    _('PCAP') + '</button>';
                html += '<button type="button" class="cbi-button cbi-button-apply" ' +
                    'data-action="get" data-type="filter" data-name="' + e.name + '" ' +
                    (e.filter ? '' : 'disabled') + '>' +
                    _('Filter') + '</button>';
                html += '<button type="button" class="cbi-button cbi-button-remove" ' +
                    'data-action="remove" data-name="' + e.name + '">' +
                    _('Remove') + '</button>';
                html += '</div>';
                c4.innerHTML = html;
            }

            var footer = tbody.insertRow();
            footer.className = 'cbi-section-table-row cbi-rowstyle-1';

            var f1 = footer.insertCell();
            f1.className = 'cbi-section-table-cell';
            f1.innerHTML = '<b>' + _('All files') + '</b>';

            var f2 = footer.insertCell();
            f2.className = 'cbi-section-table-cell';

            var f3 = footer.insertCell();
            f3.className = 'cbi-section-table-cell';
            f3.innerHTML = '<b>' + human_size(total_size) + '</b>';

            var f4 = footer.insertCell();
            f4.className = 'cbi-section-table-cell';
            f4.style.textAlign = 'right';
            f4.innerHTML =
                '<div style="display:flex;gap:4px;justify-content:flex-end;">' +
                '<button type="button" class="cbi-button cbi-button-apply" ' +
                'data-action="get" data-type="all">' +
                _('Download All') + '</button>' +
                '<button type="button" class="cbi-button cbi-button-remove" ' +
                'data-action="remove" data-name="all">' +
                _('Remove All') + '</button>' +
                '</div>';
        }

        function update_status(xhr, json) {
            if (json && json.capture) {
                capture_active = json.capture.active;
            }

            var status = document.getElementById('tcpdump-status');
            if (status) {
                if (capture_active) {
                    status.textContent = '● ' + _('RUNNING');
                    status.style.backgroundColor = 'rgba(56,161,105,0.2)';
                    status.style.color = '#38a169';
                } else {
                    status.textContent = '■ ' + _('STOPPED');
                    status.style.backgroundColor = 'rgba(128,128,128,0.2)';
                    status.style.color = 'inherit';
                }
            }

            var msg = document.getElementById('tcpdump-message');
            if (msg) {
                var text = '';
                if (json && json.cmd && json.cmd.msg) {
                    for (var i = 0; i < json.cmd.msg.length; i++) {
                        text += json.cmd.msg[i] + '\n';
                    }
                } else if (json && json.capture) {
                    text = json.capture.msg || '';
                }
                msg.textContent = text;
            }

            var log_container = document.getElementById('tcpdump-log-container');
            var log = document.getElementById('tcpdump-log');
            if (log_container && log) {
                if (capture_active && json && json.capture && json.capture.log) {
                    log_container.style.display = 'block';
                    log.textContent = json.capture.log;
                    log.scrollTop = log.scrollHeight;
                } else {
                    log_container.style.display = 'none';
                    log.textContent = '';
                }
            }

            if (json && json.list && json.list.entries) {
                render_table(json.list.entries);
            }
            update_button(capture_active);
        }

        function poll_update() {
            XHR.get(L.url('admin', 'network', 'tcpdump', 'update'),
                null, function(xhr, json) { update_status(xhr, json); });
        }

        function do_start() {
            var ifname = document.getElementById('cap_ifname').value;
            var stop_value = document.getElementById('cap_stop_value').value || '0';
            var stop_unit = document.getElementById('cap_stop_unit').value;
            var filter = document.getElementById('cap_filter').value || '';

            var url = L.url('admin', 'network', 'tcpdump', 'capture_start') +
                '?ifname=' + encodeURIComponent(ifname) +
                '&stop_value=' + encodeURIComponent(stop_value) +
                '&stop_unit=' + encodeURIComponent(stop_unit) +
                '&filter=' + encodeURIComponent(filter);

            XHR.get(url, null, function(xhr, json) { poll_update(); });
        }

        function do_stop() {
            XHR.get(L.url('admin', 'network', 'tcpdump', 'capture_stop'),
                null, function(xhr, json) { poll_update(); });
        }

        function do_get(type, cap_name) {
            var iframe = document.getElementById('hiddenDownloader');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = 'hiddenDownloader';
                iframe.style.display = 'none';
                document.body.appendChild(iframe);
            }
            iframe.src = L.url('admin', 'network', 'tcpdump', 'capture_get') + '/' +
                type + '/' + (cap_name || '');
        }

        function do_remove(cap_name) {
            if (cap_name === 'all' && !confirm(_('Are you sure you want to delete all files?'))) {
                return;
            }
            XHR.get(L.url('admin', 'network', 'tcpdump', 'capture_remove') + '/' + cap_name,
                null, function(xhr, json) { poll_update(); });
        }

        var el = E('div', { 'class': 'container' }, [
            E('h2', {}, [_('Tcpdump - Network Capture')]),

            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, [_('Start network capture')]),
                E('div', { 'class': 'cbi-section-node' }, [
                    E('div', { 'class': 'cbi-value', 'style': 'display:inline-block;padding:10px;min-width:220px;border:none;' }, [
                        E('label', { 'class': 'cbi-value-title', 'for': 'cap_ifname',
                            'style': 'float:none;width:auto;text-align:left;margin-bottom:5px;' },
                            [_('Interface')]),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('select', { 'class': 'cbi-input-select', 'id': 'cap_ifname', 'style': 'width:100%' }, [
                                E('option', { 'value': '' }, [_('Loading...')]),
                                E('option', { 'value': 'any' }, [_('any')])
                            ])
                        ])
                    }),
                    E('div', { 'class': 'cbi-value', 'style': 'display:inline-block;padding:10px;min-width:240px;border:none;' }, [
                        E('label', { 'class': 'cbi-value-title', 'for': 'cap_stop_value',
                            'style': 'float:none;width:auto;text-align:left;margin-bottom:5px;' },
                            [_('Capture limit')]),
                        E('div', { 'class': 'cbi-value-field', 'style': 'display:flex;gap:4px;' }, [
                            E('input', {
                                'class': 'cbi-input-text', 'id': 'cap_stop_value', 'type': 'text',
                                'value': '0',
                                'oninput': 'this.value=this.value.replace(/\\D/g,"")',
                                'style': 'flex:2;width:auto;'
                            }),
                            E('select', { 'class': 'cbi-input-select', 'id': 'cap_stop_unit', 'style': 'flex:1;' }, [
                                E('option', { 'value': 'T' }, [_('seconds')]),
                                E('option', { 'value': 'P' }, [_('packets')])
                            ])
                        ])
                    }),
                    E('div', { 'class': 'cbi-value', 'style': 'display:inline-block;padding:10px;min-width:260px;border:none;' }, [
                        E('label', { 'class': 'cbi-value-title', 'for': 'cap_filter',
                            'style': 'float:none;width:auto;text-align:left;margin-bottom:5px;' },
                            [_('Filter') + ' (BPF)']),
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('input', {
                                'class': 'cbi-input-text', 'id': 'cap_filter', 'type': 'text',
                                'placeholder': _('e.g. tcp port 80'),
                                'style': 'width:100%;'
                            })
                        ])
                    }),
                    E('div', { 'class': 'cbi-value', 'style': 'display:inline-block;padding:10px;min-width:160px;border:none;vertical-align:bottom;' }, [
                        E('div', { 'class': 'cbi-value-field' }, [
                            E('button', {
                                'type': 'button', 'id': 'bt_capture',
                                'class': 'cbi-button cbi-button-apply',
                                'style': 'width:100%;height:32px;', 'disabled': true
                            }, [_('Loading...')])
                        ])
                    ])
                ])
            }),

            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, [_('Console Output')]),
                E('div', { 'class': 'cbi-section-node', 'style': 'padding:15px;' }, [
                    E('div', {}, [
                        E('div', {
                            'id': 'tcpdump-status',
                            'style': 'display:inline-block;padding:5px 12px;border-radius:4px;font-weight:600;font-size:0.9rem;'
                        }, [_('Checking...')])
                    ]),
                    E('div', {
                        'id': 'tcpdump-message',
                        'style': 'font-weight:500;margin-top:10px;font-family:monospace;'
                    }),
                    E('div', { 'id': 'tcpdump-log-container', 'style': 'display:none;margin-top:10px;' }, [
                        E('pre', {
                            'id': 'tcpdump-log',
                            'style': 'padding:12px;max-height:250px;overflow-y:auto;font-family:monospace;font-size:12px;border-radius:4px;border:1px solid rgba(128,128,128,0.15);white-space:pre-wrap;line-height:1.5;'
                        })
                    ])
                ])
            }),

            E('div', { 'class': 'cbi-section' }, [
                E('legend', {}, [_('Capture files')]),
                E('div', { 'class': 'cbi-section-node' }, [
                    E('table', { 'id': 't_list', 'class': 'table cbi-section-table' }, [
                        E('thead', {}, [
                            E('tr', { 'class': 'cbi-section-table-titles' }, [
                                E('th', { 'class': 'cbi-section-table-cell' }, [_('Capture file')]),
                                E('th', { 'class': 'cbi-section-table-cell' }, [_('Modification date')]),
                                E('th', { 'class': 'cbi-section-table-cell' }, [_('Capture size')]),
                                E('th', { 'class': 'cbi-section-table-cell', 'style': 'text-align:right;' }, [_('Actions')])
                            ])
                        }),
                        E('tbody', { 'id': 't_list_body' })
                    ])
                ])
            ])
        ]);

        el.on('change', 'select#cap_ifname', function(ev) {
            // interface changed
        });

        setTimeout(function() {
            var sel = document.getElementById('cap_ifname');
            if (sel) {
                self.load_ifaces().then(function(ifaces) {
                    sel.innerHTML = '';
                    ifaces.forEach(function(name) {
                        var opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = name;
                        sel.appendChild(opt);
                    });
                    var opt_any = document.createElement('option');
                    opt_any.value = 'any';
                    opt_any.textContent = 'any';
                    sel.appendChild(opt_any);
                });
            }

            var bt = document.getElementById('bt_capture');
            if (bt) {
                bt.addEventListener('click', function() {
                    if (!capture_active) do_start();
                    else do_stop();
                });
            }

            poll_update();
            pollTimer = setInterval(poll_update, 5000);

            document.addEventListener('click', function(ev) {
                var btn = ev.target.closest('[data-action]');
                if (!btn) return;
                if (btn.dataset.action === 'get') {
                    do_get(btn.dataset.type, btn.dataset.name);
                } else if (btn.dataset.action === 'remove') {
                    do_remove(btn.dataset.name);
                }
            });
        }, 100);

        return el;
    }
});