# Feira Limpa — protótipo web
Aplicativo demonstrativo sobre a falta de limpeza imediata nas feiras livres.

Recursos
Cadastro e login demonstrativos (RF01).
Formulário de denúncia com feira, localização, tipo e descrição (RF02).
Tela de exploração de feiras e locais ilustrativos (RF03).
Histórico das denúncias no perfil/histórico (RF04).
Área de perfil para pontuação (RF05).
Seguir páginas da comunidade (RF06).
Status inicial das denúncias (RF07).
Avisos demonstrativos na interface (RF08).
Requisitos de qualidade
Layout responsivo para celulares, interface em português e uso de HTML/CSS/JavaScript sem frameworks (RNF02, RNF03, RNF05). Os registros são guardados no localStorage do navegador.

Executar
Abra esta pasta no VS Code e execute index.html no navegador ou com a extensão Live Server.

Limitações
É um protótipo front-end. Não existe autenticação real, envio de dados à prefeitura, envio de fotos ao servidor, notificações push ou banco de dados compartilhado. Para encaminhar denúncias reais, implemente um backend e integre um canal oficial do município.

GitHub
git init
git add .
git commit -m "Atualiza prototipo Feira Limpa"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/feira-limpa.git
git push -u origin main
Substitua SEU-USUARIO pelo seu usuário do GitHub.