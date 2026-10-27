require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const db = new Database('feira-limpa.sqlite');
const PORT = process.env.PORT || 3000;

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cidadao',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT,
    expires INTEGER,
    purpose TEXT,
    payload TEXT,
    attempts INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    market TEXT,
    category TEXT,
    description TEXT,
    location TEXT,
    status TEXT DEFAULT 'Recebida',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    title TEXT,
    message TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    email_notifications INTEGER DEFAULT 1,
    compact_mode INTEGER DEFAULT 0
);
`);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'DEV-CHANGE-THIS-SECRET',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 28800000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

const mailer =
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
        ? nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 465),
            secure: String(process.env.SMTP_SECURE || 'true') === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        })
        : null;

const sha = value =>
    crypto.createHash('sha256').update(String(value)).digest('hex');

const email = value =>
    String(value || '').trim().toLowerCase();

// Validação corrigida do e-mail.
const validEmail = value =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function me(req) {
    if (!req.session.uid) return null;

    return db.prepare(
        'SELECT * FROM users WHERE id = ?'
    ).get(req.session.uid);
}

function safe(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at
    };
}

function auth(req, res, next) {
    req.user = me(req);

    if (!req.user) {
        return res.status(401).json({
            error: 'Faça login para continuar.'
        });
    }

    next();
}

function admin(req, res, next) {
    if (req.user.role !== 'prefeitura') {
        return res.status(403).json({
            error: 'Apenas a prefeitura pode fazer isso.'
        });
    }

    next();
}

function notice(userId, title, message) {
    db.prepare(`
        INSERT INTO notices (user_id, title, message)
        VALUES (?, ?, ?)
    `).run(userId, title, message);

    const settings = db.prepare(`
        SELECT email_notifications
        FROM settings
        WHERE user_id = ?
    `).get(userId);

    const user = db.prepare(`
        SELECT email FROM users WHERE id = ?
    `).get(userId);

    if (mailer && user && (!settings || settings.email_notifications)) {
        mailer.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: title,
            text: message
        }).catch(error => console.error(error.message));
    }
}

async function sendCode(to, purpose, payload = {}) {
    const code = String(
        crypto.randomInt(0, 1000000)
    ).padStart(6, '0');

    db.prepare(`
        INSERT INTO codes
            (email, code_hash, expires, purpose, payload, attempts)
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(email) DO UPDATE SET
            code_hash = excluded.code_hash,
            expires = excluded.expires,
            purpose = excluded.purpose,
            payload = excluded.payload,
            attempts = 0
    `).run(
        to,
        sha(code),
        Date.now() + 600000,
        purpose,
        JSON.stringify(payload)
    );

    if (mailer) {
        await mailer.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to,
            subject: 'Código de segurança — Feira Limpa',
            text: `Seu código é ${code}. Ele expira em 10 minutos.`
        });

        return 'Código enviado por e-mail. Confira também a caixa de spam.';
    }

    console.log(`[TESTE LOCAL] Código ${purpose} para ${to}: ${code}`);

    return 'SMTP não configurado. Para testar, confira o código no terminal do servidor.';
}

function checkCode(to, code, purpose) {
    const row = db.prepare(`
        SELECT * FROM codes WHERE email = ?
    `).get(to);

    if (
        !row ||
        row.purpose !== purpose ||
        row.expires < Date.now() ||
        row.attempts >= 5
    ) {
        return null;
    }

    if (row.code_hash !== sha(code)) {
        db.prepare(`
            UPDATE codes
            SET attempts = attempts + 1
            WHERE email = ?
        `).run(to);

        return null;
    }

    db.prepare(`
        DELETE FROM codes WHERE email = ?
    `).run(to);

    return row;
}

function setSession(req, res, user) {
    req.session.regenerate(error => {
        if (error) {
            return res.status(500).json({
                error: 'Falha ao criar a sessão.'
            });
        }

        req.session.uid = user.id;

        res.json({
            ok: true,
            user: safe(user)
        });
    });
}

// Verifica a sessão atual.
app.get('/api/me', (req, res) => {
    const user = me(req);

    if (!user) {
        return res.json({ user: null });
    }

    db.prepare(`
        INSERT OR IGNORE INTO settings (user_id)
        VALUES (?)
    `).run(user.id);

    const settings = db.prepare(`
        SELECT
            email_notifications AS emailNotifications,
            compact_mode AS compactMode
        FROM settings
        WHERE user_id = ?
    `).get(user.id);

    res.json({
        user: safe(user),
        settings
    });
});

// Cadastro.
app.post('/api/register', async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const em = email(req.body.email);
        const password = String(req.body.password || '');

        if (
            name.length < 2 ||
            !validEmail(em) ||
            password.length < 8
        ) {
            return res.status(400).json({
                error: 'Informe seu nome, um e-mail válido e uma senha de pelo menos 8 caracteres.'
            });
        }

        const existing = db.prepare(`
            SELECT id FROM users WHERE email = ?
        `).get(em);

        if (existing) {
            return res.status(409).json({
                error: 'Este e-mail já está cadastrado.'
            });
        }

        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, ?)
        `).run(
            name,
            em,
            await bcrypt.hash(password, 12),
            'cidadao'
        );

        db.prepare(`
            INSERT INTO settings (user_id) VALUES (?)
        `).run(result.lastInsertRowid);

        const message = await sendCode(
            em,
            'register',
            { id: result.lastInsertRowid }
        );

        res.json({
            email: em,
            purpose: 'register',
            message
        });
    } catch (error) {
        console.error('Erro no cadastro:', error);

        res.status(500).json({
            error: 'Não foi possível concluir o cadastro. Verifique o terminal do servidor.'
        });
    }
});

// Login.
app.post('/api/login', async (req, res) => {
    try {
        const em = email(req.body.email);
        const password = String(req.body.password || '');

        const user = db.prepare(`
            SELECT * FROM users WHERE email = ?
        `).get(em);

        if (
            !user ||
            !(await bcrypt.compare(password, user.password_hash))
        ) {
            return res.status(401).json({
                error: 'E-mail ou senha incorretos.'
            });
        }

        const message = await sendCode(em, 'login', {
            id: user.id
        });

        res.json({
            email: em,
            purpose: 'login',
            message
        });
    } catch (error) {
        console.error('Erro no login:', error);

        res.status(500).json({
            error: 'Não foi possível fazer login.'
        });
    }
});

// Confirmação do código de segurança.
app.post('/api/verify', (req, res) => {
    try {
        const em = email(req.body.email);
        const purpose = String(req.body.purpose || 'login');
        const code = String(req.body.code || '');

        const row = checkCode(em, code, purpose);

        if (!row) {
            return res.status(400).json({
                error: 'Código inválido, expirado ou com tentativas esgotadas.'
            });
        }

        const payload = JSON.parse(row.payload || '{}');

        const user = db.prepare(`
            SELECT * FROM users WHERE id = ?
        `).get(payload.id);

        if (!user) {
            return res.status(404).json({
                error: 'Conta não encontrada.'
            });
        }

        setSession(req, res, user);
    } catch (error) {
        console.error('Erro ao confirmar código:', error);

        res.status(500).json({
            error: 'Não foi possível confirmar o código.'
        });
    }
});

// Reenvio de código.
app.post('/api/resend', async (req, res) => {
    try {
        const em = email(req.body.email);
        const purpose = req.body.purpose;

        const user = db.prepare(`
            SELECT id FROM users WHERE email = ?
        `).get(em);

        if (!user) {
            return res.status(404).json({
                error: 'E-mail não cadastrado.'
            });
        }

        const allowed = [
            'login',
            'register',
            'password',
            'password-change',
            'email-change'
        ];

        if (!allowed.includes(purpose)) {
            return res.status(400).json({
                error: 'Solicitação inválida.'
            });
        }

        const message = await sendCode(em, purpose, {
            id: user.id
        });

        res.json({ message });
    } catch (error) {
        console.error('Erro ao reenviar código:', error);

        res.status(500).json({
            error: 'Não foi possível reenviar o código.'
        });
    }
});

// Solicitar recuperação de senha.
app.post('/api/forgot', async (req, res) => {
    try {
        const em = email(req.body.email);

        const user = db.prepare(`
            SELECT id FROM users WHERE email = ?
        `).get(em);

        if (!user) {
            return res.json({
                message: 'Se a conta existir, um código foi solicitado.'
            });
        }

        const message = await sendCode(em, 'password', {});

        res.json({
            email: em,
            message
        });
    } catch (error) {
        console.error('Erro ao recuperar senha:', error);

        res.status(500).json({
            error: 'Não foi possível solicitar a recuperação da senha.'
        });
    }
});

// Redefinir senha.
app.post('/api/reset', async (req, res) => {
    try {
        const em = email(req.body.email);
        const password = String(req.body.password || '');
        const code = String(req.body.code || '');

        if (password.length < 8) {
            return res.status(400).json({
                error: 'A senha deve ter pelo menos 8 caracteres.'
            });
        }

        const row = checkCode(em, code, 'password');

        if (!row) {
            return res.status(400).json({
                error: 'Código inválido ou expirado.'
            });
        }

        db.prepare(`
            UPDATE users SET password_hash = ? WHERE email = ?
        `).run(await bcrypt.hash(password, 12), em);

        res.json({
            message: 'Senha alterada. Faça login novamente.'
        });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);

        res.status(500).json({
            error: 'Não foi possível alterar a senha.'
        });
    }
});

// Encerrar sessão.
app.post('/api/logout', (req, res) => {
    req.session.destroy(error => {
        if (error) {
            return res.status(500).json({
                error: 'Não foi possível encerrar a sessão.'
            });
        }

        res.clearCookie('connect.sid');
        res.json({ ok: true });
    });
});

// Atualizar perfil.
app.put('/api/profile', auth, (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const em = email(req.body.email);

        if (name.length < 2 || !validEmail(em)) {
            return res.status(400).json({
                error: 'Informe um nome e um e-mail válidos.'
            });
        }

        if (em !== req.user.email) {
            const pending = req.session.newEmail;

            if (
                !pending ||
                pending.email !== em ||
                !pending.verified ||
                pending.expires < Date.now()
            ) {
                return res.status(400).json({
                    error: 'Confirme o novo e-mail antes de salvar.'
                });
            }
        }

        const existing = db.prepare(`
            SELECT id FROM users
            WHERE email = ? AND id <> ?
        `).get(em, req.user.id);

        if (existing) {
            return res.status(409).json({
                error: 'Este e-mail já está sendo usado.'
            });
        }

        db.prepare(`
            UPDATE users SET name = ?, email = ? WHERE id = ?
        `).run(name, em, req.user.id);

        req.session.newEmail = null;

        const updated = db.prepare(`
            SELECT * FROM users WHERE id = ?
        `).get(req.user.id);

        res.json({ user: safe(updated) });
    } catch (error) {
        console.error('Erro ao atualizar perfil:', error);

        res.status(500).json({
            error: 'Não foi possível atualizar o perfil.'
        });
    }
});

// Enviar código para confirmar novo e-mail.
app.post('/api/profile/email-code', auth, async (req, res) => {
    try {
        const em = email(req.body.email);

        if (!validEmail(em)) {
            return res.status(400).json({
                error: 'E-mail inválido.'
            });
        }

        const existing = db.prepare(`
            SELECT id FROM users
            WHERE email = ? AND id <> ?
        `).get(em, req.user.id);

        if (existing) {
            return res.status(409).json({
                error: 'Este e-mail já está sendo usado.'
            });
        }

        req.session.newEmail = {
            email: em,
            verified: false,
            expires: Date.now() + 600000
        };

        const message = await sendCode(em, 'email-change', {
            id: req.user.id
        });

        res.json({ message });
    } catch (error) {
        console.error('Erro ao enviar código de e-mail:', error);

        res.status(500).json({
            error: 'Não foi possível enviar o código.'
        });
    }
});

// Confirmar novo e-mail.
app.post('/api/profile/email-verify', auth, (req, res) => {
    const em = email(req.body.email);
    const code = String(req.body.code || '');
    const pending = req.session.newEmail;

    if (
        !pending ||
        pending.email !== em ||
        pending.expires < Date.now()
    ) {
        return res.status(400).json({
            error: 'Solicite um novo código.'
        });
    }

    const row = checkCode(em, code, 'email-change');

    if (!row) {
        return res.status(400).json({
            error: 'Código inválido ou expirado.'
        });
    }

    req.session.newEmail.verified = true;

    res.json({
        message: 'E-mail confirmado. Agora salve o perfil.'
    });
});

// Solicitar alteração de senha.
app.post('/api/profile/password-code', auth, async (req, res) => {
    try {
        const currentPassword = String(
            req.body.currentPassword || ''
        );

        const newPassword = String(
            req.body.newPassword || ''
        );

        const matches = await bcrypt.compare(
            currentPassword,
            req.user.password_hash
        );

        if (!matches) {
            return res.status(400).json({
                error: 'Senha atual incorreta.'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                error: 'A nova senha deve ter pelo menos 8 caracteres.'
            });
        }

        req.session.pendingPassword = await bcrypt.hash(
            newPassword,
            12
        );

        const message = await sendCode(
            req.user.email,
            'password-change',
            { id: req.user.id }
        );

        res.json({ message });
    } catch (error) {
        console.error('Erro ao solicitar alteração de senha:', error);

        res.status(500).json({
            error: 'Não foi possível solicitar a alteração de senha.'
        });
    }
});

// Confirmar alteração de senha.
app.post('/api/profile/password-verify', auth, (req, res) => {
    const code = String(req.body.code || '');

    const row = checkCode(
        req.user.email,
        code,
        'password-change'
    );

    if (!row || !req.session.pendingPassword) {
        return res.status(400).json({
            error: 'Código inválido ou expirado.'
        });
    }

    db.prepare(`
        UPDATE users SET password_hash = ? WHERE id = ?
    `).run(req.session.pendingPassword, req.user.id);

    req.session.pendingPassword = null;

    res.json({
        message: 'Senha alterada com confirmação por e-mail.'
    });
});

// Salvar configurações.
app.put('/api/settings', auth, (req, res) => {
    const emailNotifications = req.body.emailNotifications ? 1 : 0;
    const compactMode = req.body.compactMode ? 1 : 0;

    db.prepare(`
        INSERT INTO settings
            (user_id, email_notifications, compact_mode)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            email_notifications = excluded.email_notifications,
            compact_mode = excluded.compact_mode
    `).run(
        req.user.id,
        emailNotifications,
        compactMode
    );

    res.json({ ok: true });
});

// Lista de feiras.
app.get('/api/markets', (req, res) => {
    res.json({
        markets: [
            {
                id: 'caruaru',
                name: 'Feira de Caruaru',
                city: 'Caruaru, PE',
                days: 'Segunda a sábado',
                hours: '06h–18h',
                description: 'Feira tradicional com artesanato, alimentos e produtos regionais.',
                image: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=900&q=80'
            },
            {
                id: 'sulanca',
                name: 'Feira da Sulanca',
                city: 'Santa Cruz do Capibaribe, PE',
                days: 'Consultar calendário local',
                hours: 'Manhã',
                description: 'Comércio de confecções e produtos variados.',
                image: 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?auto=format&fit=crop&w=900&q=80'
            },
            {
                id: 'hortifruti',
                name: 'Feira de frutas e verduras',
                city: 'Recife, PE',
                days: 'Consulte a feira local',
                hours: 'Manhã',
                description: 'Produtos frescos e comércio local.',
                image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80'
            }
        ]
    });
});

// Listar denúncias.
app.get('/api/reports', auth, (req, res) => {
    let reports;

    if (req.user.role === 'prefeitura') {
        reports = db.prepare(`
            SELECT r.*, u.name AS reporter
            FROM reports r
            JOIN users u ON u.id = r.user_id
            ORDER BY r.id DESC
        `).all();
    } else {
        reports = db.prepare(`
            SELECT * FROM reports
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(req.user.id);
    }

    res.json({ reports });
});

// Criar denúncia.
app.post('/api/reports', auth, (req, res) => {
    if (req.user.role !== 'cidadao') {
        return res.status(403).json({
            error: 'Somente cidadãos podem registrar denúncias.'
        });
    }

    const market = String(req.body.market || '').trim();
    const category = String(req.body.category || '').trim();
    const description = String(req.body.description || '').trim();
    const location = String(req.body.location || '').trim();

    if (!market || !category || description.length < 10) {
        return res.status(400).json({
            error: 'Preencha os campos. A descrição precisa ter pelo menos 10 caracteres.'
        });
    }

    const result = db.prepare(`
        INSERT INTO reports
            (user_id, market, category, description, location)
        VALUES (?, ?, ?, ?, ?)
    `).run(
        req.user.id,
        market,
        category,
        description,
        location
    );

    const officials = db.prepare(`
        SELECT id FROM users WHERE role = 'prefeitura'
    `).all();

    officials.forEach(official => {
        notice(
            official.id,
            'Nova denúncia recebida',
            `Denúncia em ${market}: ${category}.`
        );
    });

    notice(
        req.user.id,
        'Denúncia registrada',
        'Sua denúncia foi recebida e aguarda análise.'
    );

    res.json({
        ok: true,
        id: result.lastInsertRowid
    });
});

// Atualizar status da denúncia.
app.patch('/api/reports/:id', auth, admin, (req, res) => {
    const status = String(req.body.status || '');

    const allowedStatuses = [
        'Recebida',
        'Em análise',
        'Em atendimento',
        'Resolvida',
        'Não procedente'
    ];

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            error: 'Status inválido.'
        });
    }

    const report = db.prepare(`
        SELECT * FROM reports WHERE id = ?
    `).get(Number(req.params.id));

    if (!report) {
        return res.status(404).json({
            error: 'Denúncia não encontrada.'
        });
    }

    db.prepare(`
        UPDATE reports
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(status, report.id);

    notice(
        report.user_id,
        'Atualização da denúncia',
        `Denúncia #${report.id} (${report.market}) atualizada para: ${status}.`
    );

    res.json({ ok: true });
});

// Consultar notificações.
app.get('/api/notices', auth, (req, res) => {
    const notices = db.prepare(`
        SELECT * FROM notices
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 100
    `).all(req.user.id);

    res.json({ notices });
});

// Marcar notificações como lidas.
app.post('/api/notices/read-all', auth, (req, res) => {
    db.prepare(`
        UPDATE notices SET read = 1 WHERE user_id = ?
    `).run(req.user.id);

    res.json({ ok: true });
});

// Abrir a aplicação.
app.get('*', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// Tratar erros inesperados.
app.use((error, req, res, next) => {
    console.error('Erro no servidor:', error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        error: 'Ocorreu um erro interno no servidor.'
    });
});

app.listen(PORT, () => {
    console.log(`Feira Limpa em http://localhost:${PORT}`);
});
