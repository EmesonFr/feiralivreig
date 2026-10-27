const $ = selector => document.querySelector(selector);

const $$ = selector =>
    [...document.querySelectorAll(selector)];

let user = null;
let settings = {};
let markets = [];
let pending = {
    email: '',
    purpose: 'login'
};

let resetEmail = '';

const pageNames = {
    home: 'Início',
    markets: 'Feiras e mapa',
    reports: 'Denúncias',
    updates: 'Atualizações',
    profile: 'Editar perfil',
    settings: 'Configurações'
};

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

const attr = escapeHTML;

function formData(form) {
    return Object.fromEntries(
        new FormData(form).entries()
    );
}

function flash(message) {
    const element = $('#flash');

    if (!element) {
        alert(message);
        return;
    }

    element.textContent = message;
    element.classList.add('show');

    clearTimeout(flash.timer);

    flash.timer = setTimeout(() => {
        element.classList.remove('show');
    }, 3600);
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    let result = {};

    try {
        result = await response.json();
    } catch {
        // A resposta pode não conter JSON.
    }

    if (!response.ok) {
        throw new Error(
            result.error || 'Erro ao processar a solicitação.'
        );
    }

    return result;
}

/* AUTENTICAÇÃO */

function authForm(name) {
    $('#auth').classList.remove('hidden');
    $('#application').classList.add('hidden');

    [
        'loginForm',
        'registerForm',
        'otpForm',
        'forgotForm',
        'resetForm'
    ].forEach(id => {
        const element = $('#' + id);

        if (element) {
            element.classList.toggle(
                'hidden',
                id !== name + 'Form'
            );
        }
    });

    $$('.tab').forEach(tab => {
        tab.classList.toggle(
            'active',
            tab.dataset.tab === name
        );
    });
}

$$('[data-tab]').forEach(button => {
    button.addEventListener('click', () => {
        authForm(button.dataset.tab);
    });
});

$('#loginForm').onsubmit = async event => {
    event.preventDefault();

    try {
        const result = await api('/api/login', {
            method: 'POST',
            body: JSON.stringify(
                formData(event.target)
            )
        });

        pending = {
            email: result.email,
            purpose: 'login'
        };

        $('#otpText').textContent =
            result.message +
            ' Digite o código de seis dígitos.';

        authForm('otp');

    } catch (error) {
        flash(error.message);
    }
};

$('#registerForm').onsubmit = async event => {
    event.preventDefault();

    try {
        const result = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify(
                formData(event.target)
            )
        });

        pending = {
            email: result.email,
            purpose: 'register'
        };

        $('#otpText').textContent =
            result.message +
            ' Digite o código de seis dígitos.';

        authForm('otp');

    } catch (error) {
        flash(error.message);
    }
};

$('#otpForm').onsubmit = async event => {
    event.preventDefault();

    try {
        const result = await api('/api/verify', {
            method: 'POST',
            body: JSON.stringify({
                ...formData(event.target),
                ...pending
            })
        });

        user = result.user;

        await enterApplication();

        flash('Identidade confirmada.');

    } catch (error) {
        flash(error.message);
    }
};

$('#resend').onclick = async () => {
    try {
        const result = await api('/api/resend', {
            method: 'POST',
            body: JSON.stringify(pending)
        });

        flash(result.message);

    } catch (error) {
        flash(error.message);
    }
};

$('#cancelOtp').onclick = () => {
    authForm('login');
};

$('#forgotBtn').onclick = () => {
    authForm('forgot');
};

$('#forgotForm').onsubmit = async event => {
    event.preventDefault();

    try {
        const form = formData(event.target);

        const result = await api('/api/forgot', {
            method: 'POST',
            body: JSON.stringify(form)
        });

        resetEmail = form.email;

        flash(result.message);

        authForm('reset');

    } catch (error) {
        flash(error.message);
    }
};

$('#resetForm').onsubmit = async event => {
    event.preventDefault();

    try {
        const result = await api('/api/reset', {
            method: 'POST',
            body: JSON.stringify({
                ...formData(event.target),
                email: resetEmail
            })
        });

        flash(result.message);

        authForm('login');

    } catch (error) {
        flash(error.message);
    }
};

/* SAIR DA CONTA */

$('#logout').onclick = async () => {
    try {
        await api('/api/logout', {
            method: 'POST'
        });

        user = null;

        authForm('login');

        $('#logout').classList.add('hidden');

        flash('Você saiu da conta.');

    } catch (error) {
        flash(error.message);
    }
};

/* NAVEGAÇÃO */

$('#bell').onclick = () => {
    go('updates');
};

$$('[data-page]').forEach(button => {
    button.addEventListener('click', event => {
        event.preventDefault();

        go(button.dataset.page);
    });
});

function initials(name) {
    return String(name || 'FL')
        .split(/\s+/)
        .slice(0, 2)
        .map(part => part[0] || '')
        .join('')
        .toUpperCase();
}

async function enterApplication() {
    $('#auth').classList.add('hidden');

    $('#application').classList.remove('hidden');

    $('#logout').classList.remove('hidden');

    $('#roleBadge').textContent =
        user.role === 'prefeitura'
            ? 'Prefeitura'
            : 'Cidadão';

    $('#username').textContent = user.name;

    $('#avatar').textContent = initials(user.name);

    $('#userrole').textContent =
        user.role === 'prefeitura'
            ? 'Administração municipal'
            : 'Cidadão';

    $('#reportsLabel').textContent =
        user.role === 'prefeitura'
            ? 'Todas as denúncias'
            : 'Minhas denúncias';

    $('#date').textContent =
        new Date().toLocaleDateString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long'
        });

    const result = await api('/api/markets');

    markets = result.markets;

    go('home');
}

function go(page) {
    if (!user) {
        authForm('login');
        return;
    }

    $$('.page').forEach(element => {
        element.classList.add('hidden');
    });

    const selected = $('#page-' + page);

    if (!selected) {
        flash('Tela não encontrada.');
        return;
    }

    selected.classList.remove('hidden');

    $$('[data-page]').forEach(button => {
        button.classList.toggle(
            'active',
            button.dataset.page === page
        );
    });

    $('#pageTitle').textContent =
        pageNames[page] || page;

    $('#crumb').textContent =
        user.role === 'prefeitura'
            ? 'PAINEL DA PREFEITURA'
            : 'ÁREA DO CIDADÃO';

    render(page).catch(error => {
        flash(error.message);
    });
}

async function render(page) {
    if (page === 'home') return homePage();

    if (page === 'markets') return marketPage();

    if (page === 'reports') return reportsPage();

    if (page === 'updates') return updatesPage();

    if (page === 'profile') return profilePage();

    if (page === 'settings') return settingsPage();
}

/* CARTÕES DAS FEIRAS */

function marketCard(market) {
    return `
        <article class="market"
                 data-market="${attr(market.id)}">

            <img
                src="${attr(market.image)}"
                alt="Foto de ${attr(market.name)}"
                loading="lazy"
            >

            <div class="mbody">
                <h3>${escapeHTML(market.name)}</h3>

                <p>📍 ${escapeHTML(market.city)}</p>

                <p>
                    ${escapeHTML(market.days)}
                    ·
                    ${escapeHTML(market.hours)}
                </p>
            </div>
        </article>
    `;
}

function bindMarkets() {
    $$('.market').forEach(card => {
        card.onclick = () => {
            const market = markets.find(
                item => item.id === card.dataset.market
            );

            if (!market) return;

            const modal = document.createElement('div');

            modal.className = 'modalback';

            modal.innerHTML = `
                <div class="modal">
                    <button class="close" type="button">×</button>

                    <img
                        src="${attr(market.image)}"
                        alt="${attr(market.name)}"
                    >

                    <h2>${escapeHTML(market.name)}</h2>

                    <p>
                        ${escapeHTML(market.city)}
                        ·
                        ${escapeHTML(market.days)}
                        ·
                        ${escapeHTML(market.hours)}
                    </p>

                    <p>${escapeHTML(market.description)}</p>

                    <a
                        class="maplink"
                        target="_blank"
                        rel="noopener"
                        href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(market.name + ' ' + market.city)}"
                    >
                        Ver rota no Google Maps ↗
                    </a>
                </div>
            `;

            document.body.append(modal);

            modal.querySelector('.close').onclick = () => {
                modal.remove();
            };

            modal.onclick = event => {
                if (event.target === modal) {
                    modal.remove();
                }
            };
        };
    });
}

function mapBox() {
    return `
        <div class="mapbox">
            <div class="section-title">
                <h2>Mapa das feiras de Igarassu</h2>

                <a
                    class="maplink"
                    target="_blank"
                    rel="noopener"
                    href="https://www.google.com/maps/search/feiras+livres+Igarassu+PE/"
                >
                    Abrir Google Maps ↗
                </a>
            </div>

            <iframe
                title="Mapa de feiras em Igarassu"
                loading="lazy"
                src="https://maps.google.com/maps?q=feiras%20livres%20Igarassu%20Pernambuco&z=13&output=embed">
            </iframe>
        </div>
    `;
}

/* INÍCIO */

async function homePage() {
    const result = await api('/api/reports');

    const admin = user.role === 'prefeitura';

    $('#page-home').innerHTML = `
        <div class="welcome">
            <div>
                <small>
                    ${admin
                        ? 'GESTÃO DE LIMPEZA URBANA'
                        : 'COMUNIDADE E CIDADANIA'}
                </small>

                <h2>
                    Olá, ${escapeHTML(user.name.split(' ')[0])} 👋
                </h2>

                <p>
                    ${admin
                        ? 'Acompanhe as denúncias e mantenha a comunidade informada.'
                        : 'Encontre feiras, registre problemas de limpeza e acompanhe as respostas da prefeitura.'}
                </p>

                <button class="primary" id="homeAction">
                    ${admin
                        ? 'Analisar denúncias'
                        : 'Registrar denúncia'}
                </button>
            </div>

            <span class="emoji">
                ${admin ? '🏛️' : '🧺'}
            </span>
        </div>

        <div class="stats">
            <div class="stat">
                <small>Denúncias</small>
                <strong>${result.reports.length}</strong>
            </div>

            <div class="stat">
                <small>Feiras disponíveis</small>
                <strong>${markets.length}</strong>
            </div>

            <div class="stat">
                <small>Conta</small>
                <strong>✓</strong>
            </div>
        </div>

        <div class="section-title">
            <h2>Feiras em destaque</h2>
            <button id="allMarkets">Ver todas →</button>
        </div>

        <div class="market-grid">
            ${markets.map(marketCard).join('')}
        </div>

        ${mapBox()}
    `;

    bindMarkets();

    $('#homeAction').onclick = () => {
        admin ? go('reports') : reportModal();
    };

    $('#allMarkets').onclick = () => {
        go('markets');
    };
}

/* EXPLORAR E PESQUISAR FEIRAS */

function marketPage() {
    $('#page-markets').innerHTML = `
        <div class="toolbar">
            <input
                id="marketSearch"
                placeholder="Pesquisar feira ou cidade"
            >

            <select id="marketFilter">
                <option value="">Todas as feiras</option>
                <option value="Igarassu">Igarassu</option>
                <option value="Caruaru">Caruaru</option>
                <option value="Santa Cruz">Santa Cruz</option>
            </select>
        </div>

        <div class="market-grid" id="marketGrid">
            ${markets.map(marketCard).join('')}
        </div>

        ${mapBox()}
    `;

    const applyFilter = () => {
        const query = $('#marketSearch').value.toLowerCase();

        const city = $('#marketFilter').value;

        const filtered = markets.filter(market =>
            (market.name + ' ' + market.city)
                .toLowerCase()
                .includes(query) &&
            (!city || market.city.includes(city))
        );

        $('#marketGrid').innerHTML = filtered.length
            ? filtered.map(marketCard).join('')
            : '<div class="empty">Nenhuma feira encontrada.</div>';

        bindMarkets();
    };

    $('#marketSearch').oninput = applyFilter;

    $('#marketFilter').onchange = applyFilter;

    bindMarkets();
}

/* REGISTRAR DENÚNCIA */

function reportModal() {
    const modal = document.createElement('div');

    modal.className = 'modalback';

    modal.innerHTML = `
        <form class="modal form" id="newReport">
            <button type="button" class="close">×</button>

            <h2>Registrar denúncia</h2>

            <p>Descreva o problema de limpeza.</p>

            <label>
                Feira ou local
                <input name="market" required>
            </label>

            <label>
                Tipo de problema
                <select name="category" required>
                    <option value="">Selecione</option>
                    <option>Lixo acumulado</option>
                    <option>Falta de coleta</option>
                    <option>Entulho na passagem</option>
                    <option>Falta de lixeiras</option>
                    <option>Outro</option>
                </select>
            </label>

            <label>
                Descrição
                <textarea
                    name="description"
                    minlength="10"
                    rows="4"
                    required
                ></textarea>
            </label>

            <label>
                Local exato
                <input name="location">
            </label>

            <button class="primary">Enviar denúncia</button>
        </form>
    `;

    document.body.append(modal);

    modal.querySelector('.close').onclick = () => {
        modal.remove();
    };

    modal.onclick = event => {
        if (event.target === modal) {
            modal.remove();
        }
    };

    modal.querySelector('form').onsubmit = async event => {
        event.preventDefault();

        try {
            await api('/api/reports', {
                method: 'POST',
                body: JSON.stringify(
                    formData(event.target)
                )
            });

            modal.remove();

            flash('Denúncia registrada com sucesso.');

            go('reports');

        } catch (error) {
            flash(error.message);
        }
    };
}

/* LISTA DE DENÚNCIAS */

function reportRows(reports, admin) {
    if (!reports.length) {
        return `
            <div class="empty">
                <b>Nenhuma denúncia encontrada.</b>
                <p>As denúncias aparecerão aqui quando forem registradas.</p>
            </div>
        `;
    }

    return `
        <div class="tablebox">
            <table>
                <thead>
                    <tr>
                        <th>Denúncia</th>
                        <th>Feira/local</th>
                        <th>Status</th>
                        <th>Data</th>
                        ${admin ? '<th>Atualizar</th>' : ''}
                    </tr>
                </thead>

                <tbody>
                    ${reports.map(report => `
                        <tr>
                            <td>
                                <b>
                                    #${report.id}
                                    ·
                                    ${escapeHTML(report.category)}
                                </b>

                                <p>${escapeHTML(report.description)}</p>

                                ${admin && report.reporter
                                    ? `<small>Por ${escapeHTML(report.reporter)}</small>`
                                    : ''}
                            </td>

                            <td>
                                ${escapeHTML(report.market)}
                                <p>
                                    ${escapeHTML(report.location || 'Local não informado')}
                                </p>
                            </td>

                            <td>
                                <span class="badge">
                                    ${escapeHTML(report.status)}
                                </span>
                            </td>

                            <td>${escapeHTML(report.created_at)}</td>

                            ${admin ? `
                                <td>
                                    <select
                                        class="status"
                                        data-status="${report.id}"
                                    >
                                        ${[
                                            'Recebida',
                                            'Em análise',
                                            'Em atendimento',
                                            'Resolvida',
                                            'Não procedente'
                                        ].map(status => `
                                            <option
                                                ${status === report.status ? 'selected' : ''}
                                            >
                                                ${status}
                                            </option>
                                        `).join('')}
                                    </select>
                                </td>
                            ` : ''}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function reportsPage() {
    const admin = user.role === 'prefeitura';

    const result = await api('/api/reports');

    $('#page-reports').innerHTML = `
        <div class="section-title">
            <h2>
                ${admin
                    ? 'Todas as denúncias'
                    : 'Minhas denúncias'}
            </h2>

            ${admin
                ? ''
                : '<button id="newReport" class="maplink">+ Nova denúncia</button>'}
        </div>

        ${reportRows(result.reports, admin)}
    `;

    if (!admin) {
        $('#newReport').onclick = reportModal;
    }

    $$('[data-status]').forEach(select => {
        select.onchange = async () => {
            try {
                await api(
                    '/api/reports/' + select.dataset.status,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({
                            status: select.value
                        })
                    }
                );

                flash('Status atualizado.');

                reportsPage();

            } catch (error) {
                flash(error.message);
            }
        };
    });
}

/* ATUALIZAÇÕES */

async function updatesPage() {
    const result = await api('/api/notices');

    const unread = result.notices.filter(
        notice => !notice.read
    ).length;

    if ($('#unread')) {
        $('#unread').textContent = unread || '';
    }

    if ($('#navUnread')) {
        $('#navUnread').textContent = unread ? '●' : '';
    }

    $('#page-updates').innerHTML = `
        <div class="section-title">
            <h2>Atualizações e avisos</h2>

            <button id="readAll">
                Marcar todas como lidas
            </button>
        </div>

        <div class="updates">
            ${result.notices.length
                ? result.notices.map(notice => `
                    <article class="update ${notice.read ? '' : 'unread'}">
                        <span class="ico">🔔</span>

                        <div>
                            <h3>${escapeHTML(notice.title)}</h3>

                            <p>${escapeHTML(notice.message)}</p>

                            <small>
                                ${escapeHTML(notice.created_at)}
                            </small>
                        </div>
                    </article>
                `).join('')
                : '<div class="empty">Sem atualizações ainda.</div>'}
        </div>
    `;

    $('#readAll').onclick = async () => {
        try {
            await api('/api/notices/read-all', {
                method: 'POST'
            });

            updatesPage();

        } catch (error) {
            flash(error.message);
        }
    };
}

/* PERFIL E ALTERAÇÃO DE SENHA */

async function profilePage() {
    $('#page-profile').innerHTML = `
        <div class="profilegrid">
            <div class="card profile-summary">
                <div class="bigavatar">
                    ${initials(user.name)}
                </div>

                <h2>${escapeHTML(user.name)}</h2>

                <p>${escapeHTML(user.email)}</p>

                <span class="badge">
                    ${user.role === 'prefeitura' ? 'Prefeitura' : 'Cidadão'}
                </span>
            </div>

            <div class="card">
                <h2>Editar perfil</h2>

                <form id="profileForm" class="form">
                    <label>
                        Nome completo
                        <input
                            name="name"
                            value="${attr(user.name)}"
                            required
                            minlength="2"
                        >
                    </label>

                    <label>
                        E-mail
                        <input
                            name="email"
                            type="email"
                            value="${attr(user.email)}"
                            required
                        >
                    </label>

                    <button
                        type="button"
                        id="sendEmailCode"
                        class="outline"
                    >
                        Enviar código para novo e-mail
                    </button>

                    <label>
                        Código do novo e-mail
                        <input
                            id="emailCode"
                            maxlength="6"
                            inputmode="numeric"
                        >
                    </label>

                    <button
                        type="button"
                        id="verifyEmailCode"
                        class="outline"
                    >
                        Confirmar código do e-mail
                    </button>

                    <button class="primary">
                        Salvar perfil
                    </button>
                </form>
            </div>

            <div class="card">
                <h2>Alterar senha</h2>

                <form id="passwordForm" class="form">
                    <label>
                        Senha atual
                        <input
                            name="currentPassword"
                            type="password"
                            required
                        >
                    </label>

                    <label>
                        Nova senha
                        <input
                            name="newPassword"
                            type="password"
                            minlength="8"
                            required
                        >
                    </label>

                    <button class="primary">
                        Enviar código de segurança
                    </button>
                </form>

                <form id="passwordConfirm" class="form hidden">
                    <label>
                        Código recebido por e-mail
                        <input
                            name="code"
                            maxlength="6"
                            required
                        >
                    </label>

                    <button class="primary">
                        Confirmar e alterar senha
                    </button>
                </form>
            </div>
        </div>
    `;

    $('#sendEmailCode').onclick = async () => {
        try {
            const result = await api(
                '/api/profile/email-code',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: $('#profileForm').elements.email.value
                    })
                }
            );

            flash(result.message);

        } catch (error) {
            flash(error.message);
        }
    };

    $('#verifyEmailCode').onclick = async () => {
        try {
            const result = await api(
                '/api/profile/email-verify',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: $('#profileForm').elements.email.value,
                        code: $('#emailCode').value
                    })
                }
            );

            flash(result.message);

        } catch (error) {
            flash(error.message);
        }
    };

    $('#profileForm').onsubmit = async event => {
        event.preventDefault();

        try {
            const result = await api('/api/profile', {
                method: 'PUT',
                body: JSON.stringify(
                    formData(event.target)
                )
            });

            user = result.user;

            $('#username').textContent = user.name;

            $('#avatar').textContent = initials(user.name);

            flash('Perfil atualizado.');

            profilePage();

        } catch (error) {
            flash(error.message);
        }
    };

    $('#passwordForm').onsubmit = async event => {
        event.preventDefault();

        try {
            const result = await api(
                '/api/profile/password-code',
                {
                    method: 'POST',
                    body: JSON.stringify(
                        formData(event.target)
                    )
                }
            );

            $('#passwordConfirm').classList.remove('hidden');

            flash(result.message);

        } catch (error) {
            flash(error.message);
        }
    };

    $('#passwordConfirm').onsubmit = async event => {
        event.preventDefault();

        try {
            const result = await api(
                '/api/profile/password-verify',
                {
                    method: 'POST',
                    body: JSON.stringify(
                        formData(event.target)
                    )
                }
            );

            flash(result.message);

            $('#passwordForm').reset();

            event.target.reset();

            event.target.classList.add('hidden');

        } catch (error) {
            flash(error.message);
        }
    };
}

/* CONFIGURAÇÕES */

async function settingsPage() {
    const result = await api('/api/me');

    settings = result.settings || {};

    $('#page-settings').innerHTML = `
        <div class="card">
            <h2>Configurações</h2>

            <div class="setting">
                <div>
                    <b>Notificações por e-mail</b>
                    <small>Receber atualizações das denúncias.</small>
                </div>

                <input
                    id="emailNotifications"
                    type="checkbox"
                    ${settings.emailNotifications ? 'checked' : ''}
                >
            </div>

            <div class="setting">
                <div>
                    <b>Modo compacto</b>
                    <small>Reduzir espaçamentos da interface.</small>
                </div>

                <input
                    id="compactMode"
                    type="checkbox"
                    ${settings.compactMode ? 'checked' : ''}
                >
            </div>

            <button id="saveSettings" class="primary">
                Salvar configurações
            </button>
        </div>
    `;

    $('#saveSettings').onclick = async () => {
        try {
            await api('/api/settings', {
                method: 'PUT',
                body: JSON.stringify({
                    emailNotifications:
                        $('#emailNotifications').checked,

                    compactMode:
                        $('#compactMode').checked
                })
            });

            flash('Configurações salvas.');

        } catch (error) {
            flash(error.message);
        }
    };
}

/* INICIALIZAÇÃO */

async function init() {
    try {
        const result = await api('/api/me');

        if (result.user) {
            user = result.user;
            settings = result.settings || {};

            await enterApplication();

        } else {
            authForm('login');
        }

    } catch (error) {
        authForm('login');

        flash(
            'O servidor não respondeu. Execute npm start.'
        );
    }
}

init();
