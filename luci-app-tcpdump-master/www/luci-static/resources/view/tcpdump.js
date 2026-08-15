'use strict';

var capture_active = false;

(function() {

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

    function update_button(active) {
        var bt = document.getElementById('bt_capture');
        if (!bt) return;
        if (!active) {
            bt.textContent = 'Start capture';
            bt.className = 'cbi-button cbi-button-apply';
        } else {
            bt.textContent = 'Stop capture';
            bt.className = 'cbi-button cbi-button-reset';
        }
        bt.disabled = false;
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
            cell.innerHTML = '<em style="display:block;padding:16px 0;opacity:0.7;font-style:normal;">There are no capture files yet. Please start a capture first.</em>';
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
            html += '<button type="button" class="cbi-button cbi-button-apply" ';
            html += 'data-action="get" data-type="pcap" data-name="' + e.name + '">PCAP</button>';
            html += '<button type="button" class="cbi-button cbi-button-apply" ';
            html += 'data-action="get" data-type="filter" data-name="' + e.name + '"';
            if (!e.filter) html += ' disabled';
            html += '>Filter</button>';
            html += '<button type="button" class="cbi-button cbi-button-remove" ';
            html += 'data-action="remove" data-name="' + e.name + '">Remove</button>';
            html += '</div>';
            c4.innerHTML = html;
        }

        var footer = tbody.insertRow();
        footer.className = 'cbi-section-table-row cbi-rowstyle-1';

        var f1 = footer.insertCell();
        f1.className = 'cbi-section-table-cell';
        f1.innerHTML = '<b>All files</b>';

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
            'data-action="get" data-type="all">Download All</button>' +
            '<button type="button" class="cbi-button cbi-button-remove" ' +
            'data-action="remove" data-name="all">Remove All</button>' +
            '</div>';
    }

    function update_status(json) {
        if (json && json.capture) {
            capture_active = json.capture.active;
        }

        var status = document.getElementById('tcpdump-status');
        if (status) {
            if (capture_active) {
                status.textContent = '\u25cf RUNNING';
                status.style.backgroundColor = 'rgba(56,161,105,0.2)';
                status.style.color = '#38a169';
            } else {
                status.textContent = '\u25a0 STOPPED';
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
        XHR.get('/cgi-bin/luci/admin/network/tcpdump/update',
            null, function(xhr, json) { update_status(json); });
    }

    function do_start() {
        var ifname = document.getElementById('cap_ifname').value;
        var stop_value = document.getElementById('cap_stop_value').value || '0';
        var stop_unit = document.getElementById('cap_stop_unit').value;
        var filter = document.getElementById('cap_filter').value || '';

        var url = '/cgi-bin/luci/admin/network/tcpdump/capture_start' +
            '?ifname=' + encodeURIComponent(ifname) +
            '&stop_value=' + encodeURIComponent(stop_value) +
            '&stop_unit=' + encodeURIComponent(stop_unit) +
            '&filter=' + encodeURIComponent(filter);

        XHR.get(url, null, function(xhr, json) { poll_update(); });
    }

    function do_stop() {
        XHR.get('/cgi-bin/luci/admin/network/tcpdump/capture_stop',
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
        iframe.src = '/cgi-bin/luci/admin/network/tcpdump/capture_get/' + type + '/' + (cap_name || '');
    }

    function do_remove(cap_name) {
        if (cap_name === 'all' && !confirm('Are you sure you want to delete all files?')) {
            return;
        }
        XHR.get('/cgi-bin/luci/admin/network/tcpdump/capture_remove/' + cap_name,
            null, function(xhr, json) { poll_update(); });
    }

    function load_interfaces() {
        var sel = document.getElementById('cap_ifname');
        if (!sel) return;
        sel.innerHTML = '';
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/cgi-bin/luci/admin/network/tcpdump/interfaces', true);
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.interface) {
                        for (var i = 0; i < data.interface.length; i++) {
                            var opt = document.createElement('option');
                            opt.value = data.interface[i];
                            opt.textContent = data.interface[i];
                            sel.appendChild(opt);
                        }
                    }
                } catch (e) {}
            }
            var opt_any = document.createElement('option');
            opt_any.value = 'any';
            opt_any.textContent = 'any';
            sel.appendChild(opt_any);
        };
        xhr.send();
    }

    document.addEventListener('DOMContentLoaded', function() {
        load_interfaces();

        var bt = document.getElementById('bt_capture');
        if (bt) {
            bt.addEventListener('click', function() {
                if (!capture_active) { do_start(); }
                else { do_stop(); }
            });
        }

        poll_update();
        setInterval(poll_update, 5000);

        document.addEventListener('click', function(ev) {
            var btn = ev.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'get') {
                do_get(btn.dataset.type, btn.dataset.name);
            } else if (btn.dataset.action === 'remove') {
                do_remove(btn.dataset.name);
            }
        });
    });

})();