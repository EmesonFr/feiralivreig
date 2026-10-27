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
    secret: process.env.SESSION_SECRET || 'ALTERE-ESTA-CHAVE-SECRETA',
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

const email = value =>
    String(value || '').trim().toLowerCase();

const validEmail = value =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const hashCode = value =>
    crypto.createHash('sha256')
        .update(String(value))
        .digest('hex');

function getUser(req) {
    if (!req.session.uid) return null;

    return db.prepare(
        'SELECT * FROM users WHERE id = ?'
    ).get(req.session.uid);
}

function safeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at
    };
}

function auth(req, res, next) {
    req.user = getUser(req);

    if (!req.user) {
        return res.status(401).json({
            error: 'Faça login para continuar.'
        });
    }

    next();
}

function prefeitura(req, res, next) {
    if (req.user.role !== 'prefeitura') {
        return res.status(403).json({
            error: 'Acesso exclusivo da prefeitura.'
        });
    }

    next();
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
        hashCode(code),
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

        return 'Código enviado para seu e-mail.';
    }

    console.log(
        `[TESTE LOCAL] Código para ${to}: ${code}`
    );

    return 'Modo de teste: confira o terminal do servidor.';
}

function checkCode(to, code, purpose) {
    const row = db.prepare(
        'SELECT * FROM codes WHERE email = ?'
    ).get(to);

    if (
        !row ||
        row.purpose !== purpose ||
        row.expires < Date.now() ||
        row.attempts >= 5
    ) {
        return null;
    }

    if (row.code_hash !== hashCode(code)) {
        db.prepare(`
            UPDATE codes
            SET attempts = attempts + 1
            WHERE email = ?
        `).run(to);

        return null;
    }

    db.prepare(
        'DELETE FROM codes WHERE email = ?'
    ).run(to);

    return row;
}

function createSession(req, res, user) {
    req.session.regenerate(error => {
        if (error) {
            return res.status(500).json({
                error: 'Não foi possível iniciar a sessão.'
            });
        }

        req.session.uid = user.id;

        res.json({
            ok: true,
            user: safeUser(user)
        });
    });
}

function notify(userId, title, message) {
    db.prepare(`
        INSERT INTO notices (user_id, title, message)
        VALUES (?, ?, ?)
    `).run(userId, title, message);

    const user = db.prepare(
        'SELECT email FROM users WHERE id = ?'
    ).get(userId);

    const settings = db.prepare(`
        SELECT email_notifications
        FROM settings
        WHERE user_id = ?
    `).get(userId);

    if (mailer && user &&
        (!settings || settings.email_notifications)) {
        mailer.sendMail({
            from: process.env.MAIL_FROM || process.env.SMTP_USER,
            to: user.email,
            subject: title,
            text: message
        }).catch(console.error);
    }
}

/* PERFIL E SESSÃO */

app.get('/api/me', (req, res) => {
    const user = getUser(req);

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
        user: safeUser(user),
        settings
    });
});

/* CADASTRO */

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
                error: 'Informe nome, e-mail válido e senha com pelo menos 8 caracteres.'
            });
        }

        if (db.prepare(
            'SELECT id FROM users WHERE email = ?'
        ).get(em)) {
            return res.status(409).json({
                error: 'Este e-mail já está cadastrado.'
            });
        }

        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, 'cidadao')
        `).run(
            name,
            em,
            await bcrypt.hash(password, 12)
        );

        db.prepare(`
            INSERT INTO settings (user_id)
            VALUES (?)
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
        console.error(error);

        res.status(500).json({
            error: 'Erro ao realizar cadastro.'
        });
    }
});

/* LOGIN COM VERIFICAÇÃO */

app.post('/api/login', async (req, res) => {
    const em = email(req.body.email);

    const user = db.prepare(
        'SELECT * FROM users WHERE email = ?'
    ).get(em);

    if (
        !user ||
        !(await bcrypt.compare(
            String(req.body.password || ''),
            user.password_hash
        ))
    ) {
        return res.status(401).json({
            error: 'E-mail ou senha incorretos.'
        });
    }

    res.json({
        email: em,
        purpose: 'login',
        message: await sendCode(
            em,
            'login',
            { id: user.id }
        )
    });
});

app.post('/api/verify', (req, res) => {
    const em = email(req.body.email);

    const row = checkCode(
        em,
        String(req.body.code || ''),
        String(req.body.purpose || 'login')
    );

    if (!row) {
       
