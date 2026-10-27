async function api(url, opt = {}) {
    const method = (opt.method || 'GET').toUpperCase();
    const body = opt.body ? JSON.parse(opt.body) : {};
    const key = 'feira_limpa_demo';
    const sessionKey = 'feira_limpa_sessao';

    let db = JSON.parse(localStorage.getItem(key) || '{"users":[],"reports":[],"notices":[]}');

    function save() {
        localStorage.setItem(key, JSON.stringify(db));
    }

    function fail(message) {
        throw new Error(message);
    }

    function currentUser() {
        const email = localStorage.getItem(sessionKey);
        return db.users.find(u => u.email === email);
    }

    function publicUser(u) {
        return {
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role || 'cidadao'
        };
    }

    function loggedUser() {
        const u = currentUser();
        if (!u) fail('Faça login para continuar.');
        return u;
    }

    const demoMarkets = [
        {
            id: '1',
            name: 'Feira de Caruaru',
            city: 'Caruaru',
            days: 'Segunda a sábado',
            hours: '5h às 17h',
            image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80',
            description: 'Uma das feiras mais conhecidas de Pernambuco.'
        },
        {
            id: '2',
            name: 'Feira de Santa Cruz',
            city: 'Santa Cruz do Capibaribe',
            days: 'Segunda a sábado',
            hours: '6h às 18h',
            image: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?auto=format&fit=crop&w=900&q=80',
            description: 'Espaço de comércio e convivência da comunidade.'
        },
        {
            id: '3',
            name: 'Feira do Recife',
            city: 'Recife',
            days: 'Segunda a sábado',
            hours: '6h às 16h',
            image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=900&q=80',
            description: 'Feira livre para comércio de produtos variados.'
        }
    ];

    if (url === '/api/register' && method === 'POST') {
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');

        if (name.length < 2) fail('Digite seu nome completo.');
        if (!email.includes('@')) fail('Digite um e-mail válido.');
        if (password.length < 8) fail('A senha precisa ter pelo menos 8 caracteres.');
        if (db.users.some(u => u.email === email)) {
            fail('Este e-mail já está cadastrado. Faça login.');
        }

        db.users.push({
            id: Date.now(),
            name,
            email,
            password,
            role: 'cidadao',
            settings: {
                emailNotifications: false,
                compactMode: false
            }
        });

        save();
        return {
            email,
            message: 'Cadastro criado! Para esta demonstração, use o código 123456.'
        };
    }

    if (url === '/api/login' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const u = db.users.find(u => u.email === email && u.password === password);

        if (!u) fail('E-mail ou senha incorretos. Crie uma conta primeiro.');
        return {
            email: u.email,
            message: 'Para esta demonstração, use o código 123456.'
        };
    }

    if (url === '/api/verify' && method === 'POST') {
        if (String(body.code || '') !== '123456') {
            fail('Código incorreto. Use 123456.');
        }

        const email = String(body.email || '').trim().toLowerCase();
        const u = db.users.find(u => u.email === email);

        if (!u) fail('Conta não encontrada. Crie sua conta novamente.');

        localStorage.setItem(sessionKey, u.email);
        return { user: publicUser(u) };
    }

    if (url === '/api/resend' && method === 'POST') {
        return { message: 'Código de demonstração: 123456.' };
    }

    if (url === '/api/logout') {
        localStorage.removeItem(sessionKey);
        return { message: 'Você saiu da conta.' };
    }

    if (url === '/api/me') {
        const u = currentUser();
        return {
            user: u ? publicUser(u) : null,
            settings: u?.settings || {}
        };
    }

    if (url === '/api/markets') {
        return { markets: demoMarkets };
    }

    if (url === '/api/reports' && method === 'GET') {
        const u = loggedUser();
        const reports = db.reports.filter(r =>
            u.role === 'prefeitura' || r.email === u.email
        );
        return { reports };
    }

    if (url === '/api/reports' && method === 'POST') {
        const u = loggedUser();
        const report = {
            id: Date.now(),
            email: u.email,
            reporter: u.name,
            market: body.market || '',
            category: body.category || '',
            description: body.description || '',
            location: body.location || '',
            status: 'Recebida',
            created_at: new Date().toLocaleString('pt-BR')
        };

        db.reports.unshift(report);
        save();
        return { report };
    }

    if (url.startsWith('/api/reports/') && method === 'PATCH') {
        loggedUser();
        const id = Number(url.split('/').pop());
        const report = db.reports.find(r => r.id === id);

        if (!report) fail('Denúncia não encontrada.');

        report.status = body.status || report.status;
        save();
        return { report };
    }

    if (url === '/api/notices' && method === 'GET') {
        loggedUser();
        return { notices: db.notices };
    }

    if (url === '/api/notices/read-all' && method === 'POST') {
        loggedUser();
        db.notices.forEach(n => n.read = true);
        save();
        return { message: 'Avisos marcados como lidos.' };
    }

    if (url === '/api/profile' && method === 'PUT') {
        const u = loggedUser();
        const name = String(body.name || '').trim();
        const email = String(body.email || '').trim().toLowerCase();

        if (name.length < 2) fail('Digite seu nome.');
        if (!email.includes('@')) fail('Digite um e-mail válido.');

        if (db.users.some(other => other.email === email && other.id !== u.id)) {
            fail('Este e-mail já está sendo usado.');
        }

        u.name = name;
        u.email = email;
        localStorage.setItem(sessionKey, email);
        save();

        return { user: publicUser(u) };
    }

    if (url === '/api/settings' && method === 'PUT') {
        const u = loggedUser();
        u.settings = body;
        save();
        return { message: 'Configurações salvas.' };
    }

    if (url === '/api/forgot' && method === 'POST') {
        return { message: 'Para esta demonstração, use o código 123456.' };
    }

    if (url === '/api/reset' && method === 'POST') {
        const email = String(body.email || '').trim().toLowerCase();
        const u = db.users.find(u => u.email === email);

        if (!u) fail('Conta não encontrada.');
        if (String(body.code || '') !== '123456') fail('Código incorreto.');
        if (String(body.password || '').length < 8) fail('A senha precisa ter 8 caracteres.');

        u.password = body.password;
        save();
        return { message: 'Senha alterada com sucesso.' };
    }

    if (url.startsWith('/api/profile/')) {
        fail('Esta função de perfil não está disponível na demonstração.');
    }

    fail('Função não reconhecida: ' + url);
}
