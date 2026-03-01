/* ModBot Web Dashboard */
(function () {
    'use strict';

    // ── State ───────────────────────────────────────────────────────────────
    let currentUser = null;
    let guilds = [];

    // Cache for resolved user info (id -> {username, avatar})
    const userCache = {};

    // ── Helpers ─────────────────────────────────────────────────────────────

    function getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    async function api(path, options = {}) {
        const headers = {'Content-Type': 'application/json', ...options.headers};
        if (options.method && options.method !== 'GET') {
            headers['X-CSRF-Token'] = getCsrfToken();
        }
        const res = await fetch(`/api${path}`, {
            ...options,
            headers,
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    function avatarUrl(id, hash, size = 32) {
        if (!hash) return `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`;
        return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=${size}`;
    }

    function guildIconUrl(guild, size = 64) {
        if (!guild.icon) return null;
        return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=${size}`;
    }

    function badgeCls(action) {
        const map = {ban: 'ban', mute: 'mute', kick: 'kick', strike: 'strike',
            softban: 'softban', pardon: 'pardon', unban: 'unban', unmute: 'unmute'};
        return `badge badge-${map[action] || 'default'}`;
    }

    function fmtTime(ts) {
        if (!ts) return '—';
        return new Date(ts * 1000).toLocaleString();
    }

    function fmtDuration(secs) {
        if (!secs) return '—';
        const units = [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']];
        let rem = secs, parts = [];
        for (const [div, label] of units) {
            const n = Math.floor(rem / div);
            if (n) { parts.push(`${n}${label}`); rem %= div; }
        }
        return parts.slice(0, 2).join(' ') || '—';
    }

    function el(tag, attrs = {}, ...children) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'className') e.className = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        }
        for (const c of children) {
            if (c == null) continue;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return e;
    }

    // ── User mention chip ────────────────────────────────────────────────────

    /**
     * Fetch and cache Discord user info for a given ID
     * @param {string} userId
     * @returns {Promise<{id:string,username:string,avatar:string|null}|null>}
     */
    async function fetchUserInfo(userId) {
        if (!userId || !/^\d{17,20}$/.test(userId)) return null;
        if (userCache[userId] !== undefined) return userCache[userId];
        try {
            const info = await api(`/users/${userId}`);
            userCache[userId] = info;
            return info;
        } catch {
            userCache[userId] = null;
            return null;
        }
    }

    /**
     * Build a user mention chip (avatar + username)
     * Falls back to raw ID if user info is unavailable.
     * @param {string} userId
     * @returns {HTMLElement}
     */
    function buildUserChip(userId) {
        const chip = el('span', {className: 'user-chip'});
        chip.textContent = userId;

        fetchUserInfo(userId).then(info => {
            if (!info) return;
            chip.innerHTML = '';
            chip.appendChild(el('img', {
                src: avatarUrl(info.id, info.avatar, 32),
                className: 'user-chip-avatar',
                alt: info.username,
            }));
            chip.appendChild(document.createTextNode(info.username));
        });

        return chip;
    }

    // ── Modal ────────────────────────────────────────────────────────────────

    function openModal(title, bodyEl, onSubmit, submitLabel = 'Save') {
        const overlay = el('div', {className: 'modal-overlay', onClick: e => {
            if (e.target === overlay) closeModal(overlay);
        }});

        const modal = el('div', {className: 'modal'});
        const header = el('div', {className: 'modal-header'},
            el('h3', {}, title),
            el('button', {className: 'modal-close', onClick: () => closeModal(overlay)}, '✕')
        );
        const body = el('div', {className: 'modal-body'}, bodyEl);
        const errEl = el('div', {className: 'modal-error'});
        const submitBtn = el('button', {className: 'btn btn-primary', onClick: async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = '…';
            try {
                await onSubmit();
                closeModal(overlay);
            } catch (err) {
                errEl.textContent = err.message;
                submitBtn.disabled = false;
                submitBtn.textContent = submitLabel;
            }
        }}, submitLabel);
        const footer = el('div', {className: 'modal-footer'},
            submitBtn,
            el('button', {className: 'btn btn-secondary', onClick: () => closeModal(overlay)}, 'Cancel')
        );
        modal.append(header, body, errEl, footer);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Focus first input
        requestAnimationFrame(() => {
            const first = modal.querySelector('input:not([type=checkbox]), textarea, select');
            if (first) first.focus();
        });

        return overlay;
    }

    function closeModal(overlay) {
        overlay.remove();
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    async function init() {
        try {
            currentUser = await api('/me');
            guilds = await api('/guilds');
            renderApp();
        } catch {
            renderLogin();
        }
    }

    // ── Login Page ───────────────────────────────────────────────────────────

    function renderLogin() {
        document.body.innerHTML = '';
        document.body.appendChild(
            el('div', {id: 'login-page'},
                el('div', {style: 'font-size:2.8rem;margin-bottom:4px'}, '🤖'),
                el('h1', {}, 'ModBot Dashboard'),
                el('p', {}, 'Sign in with Discord to manage your server\'s moderation settings.'),
                el('a', {href: '/auth/login', className: 'login-btn'},
                    '🎮 Login with Discord'
                )
            )
        );
    }

    // ── App Shell ────────────────────────────────────────────────────────────

    function renderApp() {
        document.body.innerHTML = '';
        const app = el('div', {id: 'app'});
        app.appendChild(buildSidebar());
        const main = el('div', {id: 'main'});
        app.appendChild(main);
        document.body.appendChild(app);

        if (guilds.length > 0) {
            selectGuild(guilds[0].id);
        } else {
            main.appendChild(el('div', {className: 'empty-state'},
                el('span', {className: 'empty-state-icon'}, '🏰'),
                el('p', {}, 'No guilds with Manage Server permission found.')
            ));
        }
    }

    function buildSidebar() {
        const sidebar = el('div', {id: 'sidebar'});
        sidebar.appendChild(el('div', {className: 'logo'}, '🤖 ModBot'));

        const list = el('div', {className: 'guild-list'});
        for (const guild of guilds) {
            const icon = guildIconUrl(guild);
            const iconEl = icon
                ? el('img', {src: icon, className: 'guild-icon', alt: guild.name})
                : el('div', {className: 'guild-icon'}, guild.name.charAt(0).toUpperCase());

            const item = el('div', {className: 'guild-item', 'data-id': guild.id,
                onClick: () => selectGuild(guild.id)},
            iconEl,
            el('span', {}, guild.name.length > 18 ? guild.name.slice(0, 17) + '…' : guild.name)
            );
            list.appendChild(item);
        }
        sidebar.appendChild(list);

        const userInfo = el('div', {className: 'user-info'},
            el('img', {
                src: avatarUrl(currentUser.id, currentUser.avatar),
                className: 'user-avatar',
                alt: currentUser.username,
            }),
            el('span', {className: 'user-name'}, currentUser.username),
            el('button', {className: 'logout-btn', onClick: () => { location.href = '/auth/logout'; }}, 'Logout')
        );
        sidebar.appendChild(userInfo);
        return sidebar;
    }

    function selectGuild(id) {
        // Update sidebar active state
        document.querySelectorAll('.guild-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === id);
        });
        renderGuildDashboard(id);
    }

    // ── Guild Dashboard ──────────────────────────────────────────────────────

    function renderGuildDashboard(guildId) {
        const main = document.getElementById('main');
        main.innerHTML = '';

        const guild = guilds.find(g => g.id === guildId);
        main.appendChild(el('h2', {className: 'page-title'}, guild?.name ?? guildId));
        main.appendChild(el('p', {className: 'page-subtitle'}, `Guild ID: ${guildId}`));

        const tabs = el('div', {className: 'tabs'});
        const tabDefs = [
            {id: 'settings', label: '⚙️ Settings'},
            {id: 'moderations', label: '🔨 Moderations'},
            {id: 'badwords', label: '🚫 Bad Words'},
            {id: 'responses', label: '💬 Auto-Responses'},
        ];

        const contents = {};
        for (const t of tabDefs) {
            const btn = el('button', {className: 'tab-btn', onClick: () => activateTab(t.id)}, t.label);
            btn.dataset.tab = t.id;
            tabs.appendChild(btn);

            const content = el('div', {className: 'tab-content'});
            content.dataset.tabContent = t.id;
            contents[t.id] = content;
            main.appendChild(content);
        }
        main.insertBefore(tabs, main.children[2]);

        activateTab('settings');
        loadTab('settings', guildId, contents);

        tabs.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activateTab(btn.dataset.tab);
                loadTab(btn.dataset.tab, guildId, contents);
            });
        });
    }

    function activateTab(id) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tabContent === id));
    }

    function loadTab(id, guildId, contents) {
        const el = contents[id];
        if (el.dataset.loaded === guildId) return;
        el.dataset.loaded = guildId;

        switch (id) {
            case 'settings': loadSettings(guildId, el); break;
            case 'moderations': loadModerations(guildId, el); break;
            case 'badwords': loadBadWords(guildId, el); break;
            case 'responses': loadResponses(guildId, el); break;
        }
    }

    // ── Settings Tab ─────────────────────────────────────────────────────────

    async function loadSettings(guildId, container) {
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        try {
            const s = await api(`/guilds/${guildId}/settings`);
            container.innerHTML = '';

            // Logging
            container.appendChild(buildSettingsSection('📋 Logging', {
                'Log Channel': s.logChannel ?? 'Not set',
                'Message Log Channel': s.messageLogChannel ?? 'Not set',
                'Join Log Channel': s.joinLogChannel ?? 'Not set',
            }));

            // Roles
            const rolesCard = buildSettingsSection('👑 Roles', {
                'Muted Role': s.mutedRole ?? 'Not set',
            });
            if (s.protectedRoles?.length) {
                const grid = rolesCard.querySelector('.settings-grid');
                const item = buildSettingItem('Protected Roles', '');
                item.querySelector('.setting-value').replaceChildren(
                    ...s.protectedRoles.map(r => el('span', {className: 'tag'}, r))
                );
                grid.appendChild(item);
            }
            container.appendChild(rolesCard);

            // Automod
            container.appendChild(buildSettingsSection('🛡️ Automod', {
                'Invites Allowed': s.invites ? '✅ Yes' : '❌ No',
                'Link Cooldown': s.linkCooldown === -1 ? 'Disabled' : `${s.linkCooldown}s`,
                'Attachment Cooldown': s.attachmentCooldown === -1 ? 'Disabled' : `${s.attachmentCooldown}s`,
                'Caps Filter': s.caps ? '✅ Enabled (forbids excessive caps)' : '❌ Disabled',
                'Anti-Spam': s.antiSpam === -1 ? 'Disabled' : `${s.antiSpam} msgs`,
                'Similar Messages': s.similarMessages === -1 ? 'Disabled' : `${s.similarMessages} msgs`,
            }));

            // Safe Search
            if (s.safeSearch) {
                container.appendChild(buildSettingsSection('🔍 Safe Search', {
                    'Enabled': s.safeSearch.enabled ? '✅ Yes' : '❌ No',
                    'Strikes': String(s.safeSearch.strikes ?? 1),
                    'Likelihood': String(s.safeSearch.likelihood ?? 1),
                }));
            }

            // Connections
            container.appendChild(buildSettingsSection('🔗 Connections', {
                'YouTube Playlist': s.playlist ?? 'Not set',
                'Help Center': s.helpcenter ? `${s.helpcenter}.zendesk.com` : 'Not set',
            }));
        } catch (err) {
            container.innerHTML = `<div class="empty-state">Failed to load settings: ${err.message}</div>`;
        }
    }

    function buildSettingsSection(title, fields) {
        const card = el('div', {className: 'card'});
        card.appendChild(el('h3', {}, title));
        const grid = el('div', {className: 'settings-grid'});
        for (const [k, v] of Object.entries(fields)) {
            grid.appendChild(buildSettingItem(k, v));
        }
        card.appendChild(grid);
        return card;
    }

    function buildSettingItem(label, value) {
        return el('div', {className: 'setting-item'},
            el('label', {}, label),
            el('div', {className: 'setting-value'}, String(value))
        );
    }

    // ── Moderations Tab ──────────────────────────────────────────────────────

    async function loadModerations(guildId, container) {
        container.innerHTML = '';

        const filterBar = el('div', {className: 'filter-bar'});
        const userInput = el('input', {type: 'text', placeholder: 'User ID…'});
        const actionSel = el('select', {});
        for (const a of ['', 'ban', 'unban', 'kick', 'mute', 'unmute', 'strike', 'pardon', 'softban']) {
            actionSel.appendChild(el('option', {value: a}, a || 'All actions'));
        }
        const searchBtn = el('button', {className: 'btn btn-primary btn-sm', onClick: doSearch}, '🔍 Search');
        filterBar.append(userInput, actionSel, searchBtn);
        container.appendChild(filterBar);

        const tableWrapper = el('div', {className: 'table-wrapper'});
        container.appendChild(tableWrapper);

        async function doSearch() {
            tableWrapper.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
            const params = new URLSearchParams({limit: '50'});
            if (userInput.value.trim()) params.set('userId', userInput.value.trim());
            if (actionSel.value) params.set('action', actionSel.value);
            try {
                const mods = await api(`/guilds/${guildId}/moderations?${params}`);
                renderModTable(tableWrapper, mods);
            } catch (err) {
                tableWrapper.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
            }
        }

        await doSearch();
    }

    function renderModTable(container, mods) {
        container.innerHTML = '';
        if (!mods.length) {
            container.appendChild(el('div', {className: 'empty-state'},
                el('span', {className: 'empty-state-icon'}, '📋'),
                el('p', {}, 'No moderations found.')
            ));
            return;
        }
        const table = el('table', {});
        table.appendChild(el('thead', {}, el('tr', {},
            ...['ID', 'Action', 'User', 'Moderator', 'Date', 'Duration', 'Reason', 'Active'].map(h =>
                el('th', {}, h))
        )));
        const tbody = el('tbody', {});
        for (const m of mods) {
            const duration = m.expireTime ? fmtDuration(m.expireTime - m.created) : '—';
            tbody.appendChild(el('tr', {},
                el('td', {className: 'mono'}, String(m.id)),
                el('td', {}, el('span', {className: badgeCls(m.action)}, m.action)),
                el('td', {}, buildUserChip(m.userid)),
                el('td', {}, m.moderator ? buildUserChip(m.moderator) : '—'),
                el('td', {}, fmtTime(m.created)),
                el('td', {}, duration),
                el('td', {}, m.reason?.substring(0, 60) ?? '—'),
                el('td', {}, m.active ? '✅' : '—')
            ));
        }
        table.appendChild(tbody);
        container.appendChild(table);
    }

    // ── Bad Words Tab ────────────────────────────────────────────────────────

    async function loadBadWords(guildId, container) {
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        try {
            const items = await api(`/guilds/${guildId}/badwords`);
            container.innerHTML = '';

            const toolbar = el('div', {className: 'toolbar'});
            toolbar.appendChild(el('button', {className: 'btn btn-primary btn-sm', onClick: () => openAddBadWordModal(guildId, container)}, '＋ Add Word'));
            toolbar.appendChild(el('button', {className: 'btn btn-secondary btn-sm', onClick: () => openBulkImportModal(guildId, container)}, '⬆ Bulk Import'));
            container.appendChild(toolbar);

            if (!items.length) {
                container.appendChild(el('div', {className: 'empty-state'},
                    el('span', {className: 'empty-state-icon'}, '🚫'),
                    el('p', {}, 'No bad words configured. Use the buttons above to add words.')
                ));
                return;
            }
            const table = buildTriggerTable(items, ['Punishment', 'Priority'], (bw) => [
                `${bw.punishment?.action ?? '—'} ${bw.punishment?.duration ?? ''}`.trim(),
                String(bw.priority ?? 0),
            ], async (bw) => {
                if (!confirm(`Delete bad word #${bw.id}?`)) return;
                await api(`/guilds/${guildId}/badwords/${bw.id}`, {method: 'DELETE'});
                delete container.dataset.loaded;
                container.innerHTML = '';
                loadBadWords(guildId, container);
            });
            container.appendChild(table);
        } catch (err) {
            container.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
        }
    }

    function openAddBadWordModal(guildId, container) {
        const form = el('div', {className: 'form-grid'});

        const triggerTypeSel = el('select', {className: 'form-input'});
        for (const t of ['include', 'match', 'regex', 'phishing']) {
            triggerTypeSel.appendChild(el('option', {value: t}, t));
        }

        const triggerInput = el('input', {type: 'text', className: 'form-input', placeholder: 'word or /regex/flags'});
        const punishSel = el('select', {className: 'form-input'});
        for (const p of ['none', 'ban', 'kick', 'mute', 'softban', 'strike']) {
            punishSel.appendChild(el('option', {value: p}, p));
        }
        const durationInput = el('input', {type: 'text', className: 'form-input', placeholder: 'e.g. 86400 (seconds, optional)'});
        const responseInput = el('input', {type: 'text', className: 'form-input', placeholder: 'Optional response message'});
        const priorityInput = el('input', {type: 'number', className: 'form-input', value: '0', placeholder: '0'});
        const dmInput = el('input', {type: 'text', className: 'form-input', placeholder: 'Optional DM to user'});
        const globalChk = el('input', {type: 'checkbox', className: 'form-input', id: 'bw-global'});

        form.append(
            buildFormField('Trigger Type', triggerTypeSel),
            buildFormField('Trigger Content', triggerInput),
            buildFormFieldRow(
                buildFormField('Punishment', punishSel),
                buildFormField('Duration (seconds)', durationInput)
            ),
            buildFormField('Response', responseInput),
            buildFormFieldRow(
                buildFormField('Priority', priorityInput),
                buildFormField('Global (all channels)', globalChk)
            ),
            buildFormField('DM Message', dmInput),
        );

        openModal('Add Bad Word', form, async () => {
            const result = await api(`/guilds/${guildId}/badwords`, {
                method: 'POST',
                body: JSON.stringify({
                    triggerType: triggerTypeSel.value,
                    triggerContent: triggerInput.value.trim(),
                    punishment: punishSel.value,
                    duration: durationInput.value.trim() || null,
                    response: responseInput.value.trim() || null,
                    priority: parseInt(priorityInput.value) || 0,
                    dm: dmInput.value.trim() || null,
                    global: globalChk.checked,
                    channels: [],
                }),
            });
            if (!result.id) throw new Error('Failed to create bad word');
            delete container.dataset.loaded;
            container.innerHTML = '';
            loadBadWords(guildId, container);
        });
    }

    // ── Bulk Import Modal ────────────────────────────────────────────────────

    function openBulkImportModal(guildId, container) {
        const form = el('div', {className: 'form-grid'});

        const wordsTextarea = el('textarea', {
            className: 'form-input',
            placeholder: 'bad\nword\nanother phrase\none per line…',
            rows: '8',
        });

        const previewEl = el('span', {className: 'count'}, '0');
        const previewBanner = el('div', {className: 'bulk-preview'},
            'Words to import:',
            previewEl
        );

        wordsTextarea.addEventListener('input', () => {
            const count = parseWordList(wordsTextarea.value).length;
            previewEl.textContent = String(count);
        });

        const triggerTypeSel = el('select', {className: 'form-input'});
        for (const t of ['include', 'match', 'regex']) {
            triggerTypeSel.appendChild(el('option', {value: t}, t));
        }

        const punishSel = el('select', {className: 'form-input'});
        for (const p of ['none', 'ban', 'kick', 'mute', 'softban', 'strike']) {
            punishSel.appendChild(el('option', {value: p}, p));
        }
        const durationInput = el('input', {type: 'text', className: 'form-input', placeholder: 'e.g. 86400 (seconds, optional)'});
        const globalChk = el('input', {type: 'checkbox', className: 'form-input', id: 'bw-bulk-global'});

        const wordsField = el('div', {className: 'form-field'});
        wordsField.appendChild(el('div', {style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:5px'},
            el('label', {className: 'form-label'}, 'Words — one per line'),
            previewBanner
        ));
        wordsField.appendChild(wordsTextarea);
        wordsField.appendChild(el('p', {className: 'form-hint'}, 'Each non-empty line becomes a separate bad word entry.'));

        form.append(
            wordsField,
            buildFormField('Trigger Type', triggerTypeSel),
            buildFormFieldRow(
                buildFormField('Punishment', punishSel),
                buildFormField('Duration (seconds)', durationInput)
            ),
            buildFormField('Global (all channels)', globalChk),
        );

        openModal('Bulk Import Bad Words', form, async () => {
            const words = parseWordList(wordsTextarea.value);
            if (!words.length) throw new Error('Enter at least one word.');

            const data = await api(`/guilds/${guildId}/badwords/bulk`, {
                method: 'POST',
                body: JSON.stringify({
                    words,
                    triggerType: triggerTypeSel.value,
                    punishment: punishSel.value,
                    duration: durationInput.value.trim() || null,
                    global: globalChk.checked,
                    channels: [],
                }),
            });

            delete container.dataset.loaded;
            container.innerHTML = '';
            loadBadWords(guildId, container);

            // Show result banner after reload
            requestAnimationFrame(() => {
                const banner = el('div', {className: `import-result ${data.failed > 0 ? 'error' : 'success'}`},
                    data.failed > 0
                        ? `✅ Imported ${data.created} word(s) — ⚠️ ${data.failed} failed`
                        : `✅ Successfully imported ${data.created} word(s)`
                );
                const toolbar = container.querySelector('.toolbar');
                if (toolbar) toolbar.after(banner);
                else container.prepend(banner);
                setTimeout(() => banner.remove(), 6000);
            });
        }, 'Import');
    }

    /**
     * Parse a newline-separated word list, trimming whitespace and removing blank lines.
     * @param {string} text
     * @returns {string[]}
     */
    function parseWordList(text) {
        return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    }

    // ── Auto-Responses Tab ───────────────────────────────────────────────────

    async function loadResponses(guildId, container) {
        container.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';
        try {
            const items = await api(`/guilds/${guildId}/responses`);
            container.innerHTML = '';

            const toolbar = el('div', {className: 'toolbar'});
            toolbar.appendChild(el('button', {className: 'btn btn-primary btn-sm', onClick: () => openAddResponseModal(guildId, container)}, '＋ Add Auto-Response'));
            container.appendChild(toolbar);

            if (!items.length) {
                container.appendChild(el('div', {className: 'empty-state'},
                    el('span', {className: 'empty-state-icon'}, '💬'),
                    el('p', {}, 'No auto-responses configured.')
                ));
                return;
            }
            const table = buildTriggerTable(items, ['Response'], (r) => [
                r.response?.substring(0, 60) ?? '—',
            ], async (r) => {
                if (!confirm(`Delete auto-response #${r.id}?`)) return;
                await api(`/guilds/${guildId}/responses/${r.id}`, {method: 'DELETE'});
                delete container.dataset.loaded;
                container.innerHTML = '';
                loadResponses(guildId, container);
            });
            container.appendChild(table);
        } catch (err) {
            container.innerHTML = `<div class="empty-state">Failed to load: ${err.message}</div>`;
        }
    }

    function openAddResponseModal(guildId, container) {
        const form = el('div', {className: 'form-grid'});

        const triggerTypeSel = el('select', {className: 'form-input'});
        for (const t of ['include', 'match', 'regex', 'phishing']) {
            triggerTypeSel.appendChild(el('option', {value: t}, t));
        }
        const triggerInput = el('input', {type: 'text', className: 'form-input', placeholder: 'word or /regex/flags'});
        const responseInput = el('input', {type: 'text', className: 'form-input', placeholder: 'Response message'});
        const globalChk = el('input', {type: 'checkbox', className: 'form-input', id: 'resp-global'});

        form.append(
            buildFormField('Trigger Type', triggerTypeSel),
            buildFormField('Trigger Content', triggerInput),
            buildFormField('Response', responseInput),
            buildFormField('Global (all channels)', globalChk),
        );

        openModal('Add Auto-Response', form, async () => {
            const result = await api(`/guilds/${guildId}/responses`, {
                method: 'POST',
                body: JSON.stringify({
                    triggerType: triggerTypeSel.value,
                    triggerContent: triggerInput.value.trim(),
                    response: responseInput.value.trim(),
                    global: globalChk.checked,
                    channels: [],
                }),
            });
            if (!result.id) throw new Error('Failed to create auto-response');
            delete container.dataset.loaded;
            container.innerHTML = '';
            loadResponses(guildId, container);
        });
    }

    // ── Form Helpers ─────────────────────────────────────────────────────────

    function buildFormField(label, inputEl) {
        const wrapper = el('div', {className: 'form-field'});
        wrapper.appendChild(el('label', {className: 'form-label'}, label));
        wrapper.appendChild(inputEl);
        return wrapper;
    }

    function buildFormFieldRow(...fields) {
        const row = el('div', {className: 'form-row'});
        for (const f of fields) row.appendChild(f);
        return row;
    }

    // ── Shared trigger table builder ─────────────────────────────────────────

    function buildTriggerTable(items, extraHeaders, extraCells, onDelete) {
        const wrapper = el('div', {className: 'table-wrapper'});
        const table = el('table', {});
        const headers = ['ID', 'Type', 'Trigger', 'Scope', ...extraHeaders, 'Actions'];
        table.appendChild(el('thead', {}, el('tr', {},
            ...headers.map(h => el('th', {}, h))
        )));
        const tbody = el('tbody', {});
        for (const item of items) {
            const scope = item.global ? 'Global' : `${item.channels?.length ?? 0} channels`;
            const delBtn = el('button', {className: 'btn btn-danger btn-sm', onClick: () => onDelete(item)}, '🗑');
            tbody.appendChild(el('tr', {},
                el('td', {className: 'mono'}, String(item.id)),
                el('td', {}, el('span', {className: 'badge badge-default'}, item.trigger?.type ?? '—')),
                el('td', {className: 'mono'}, item.trigger?.content?.substring(0, 40) ?? '—'),
                el('td', {}, scope),
                ...extraCells(item).map(v => el('td', {}, v)),
                el('td', {}, delBtn)
            ));
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        return wrapper;
    }

    // ── Bootstrap ────────────────────────────────────────────────────────────

    document.addEventListener('DOMContentLoaded', init);
})();
