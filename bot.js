const wppconnect = require('@wppconnect-team/wppconnect');
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'urbantrend',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Função para verificar e enviar lembretes de carrinho abandonado
async function verificarCarrinhosAbandonados(client) {
    // Buscar usuários com último acesso há mais de 5 dias
    const sqlUsuarios = `
        SELECT id, nome, telefone, produtos_no_carrinho, carrinho_lembrado
        FROM Usuarios 
        WHERE ultimo_acesso <= DATE_SUB(NOW(), INTERVAL 5 DAY)
    `;

    pool.query(sqlUsuarios, (err, usuarios) => {
        if (err) {
            console.error('Erro ao buscar usuários:', err);
            return;
        }

        if (!usuarios || usuarios.length === 0) {
            console.log('Nenhum usuário encontrado para lembrete');
            return;
        }

        // Para cada usuário, buscar os produtos no carrinho
        usuarios.forEach(usuario => {
            try {
                // Converter a string de produtos para array
                const produtosNoCarrinho = usuario.produtos_no_carrinho 
                    ? usuario.produtos_no_carrinho.split(',').map(id => parseInt(id.trim()))
                    : [];

                // Se não houver produtos no carrinho, pular este usuário
                if (!produtosNoCarrinho || produtosNoCarrinho.length === 0) {
                    console.log(`Usuário ${usuario.nome} não tem produtos no carrinho`);
                    return;
                }

                // Criar placeholders para a consulta IN
                const placeholders = produtosNoCarrinho.map(() => '?').join(',');
                
                // Buscar detalhes dos produtos
                const sqlProdutos = `
                    SELECT nome, preco, link_compra
                    FROM Produtos
                    WHERE id IN (${placeholders})
                `;

                pool.query(sqlProdutos, produtosNoCarrinho, (err, produtos) => {
                    if (err) {
                        console.error('Erro ao buscar produtos:', err);
                        return;
                    }

                    if (!produtos || produtos.length === 0) {
                        console.log(`Nenhum produto encontrado para o usuário ${usuario.nome}`);
                        return;
                    }

                    // Montar mensagem
                    let mensagem = `👋 Olá ${usuario.nome}!\n\n`;
                    mensagem += `Notamos que você deixou alguns produtos no carrinho há mais de 5 dias:\n\n`;
                    
                    produtos.forEach(produto => {
                        mensagem += `👕 ${produto.nome}\n`;
                        mensagem += `💰 R$ ${produto.preco}\n`;
                        mensagem += `🔗 ${produto.link_compra}\n\n`;
                    });

                    mensagem += `Não perca a chance de finalizar sua compra! Os produtos podem acabar em breve. 😊\n`;
                    mensagem += `Precisa de ajuda? Estamos aqui para te ajudar!`;

                    // Enviar mensagem
                    client.sendText(usuario.telefone, mensagem)
                        .then(() => {
                            console.log(`Lembrete enviado para ${usuario.nome}`);
                            // Incrementar contador de lembretes
                            const sqlUpdate = 'UPDATE Usuarios SET carrinho_lembrado = carrinho_lembrado + 1 WHERE id = ?';
                            pool.query(sqlUpdate, [usuario.id], (err) => {
                                if (err) {
                                    console.error(`Erro ao atualizar contador de lembretes para ${usuario.nome}:`, err);
                                }
                            });
                        })
                        .catch(err => console.error(`Erro ao enviar lembrete para ${usuario.nome}:`, err));
                });
            } catch (error) {
                console.error('Erro ao processar produtos do carrinho:', error);
            }
        });
    });
}

// Função para responder perguntas frequentes
async function responderFAQ(message, client) {
    const pergunta = message.body.toLowerCase();
    const numeroContato = message.from;

    // Buscar todas as perguntas e respostas
    const sqlFAQ = 'SELECT pergunta, resposta FROM FAQ';
    
    pool.query(sqlFAQ, (err, faqs) => {
        if (err) {
            console.error('Erro ao buscar FAQ:', err);
            client.sendText(numeroContato, '❌ Desculpe, ocorreu um erro ao buscar a resposta. Tente novamente.');
            return;
        }

        // Verificar cada pergunta
        for (const faq of faqs) {
            const palavrasChave = faq.pergunta.split(',').map(p => p.trim().toLowerCase());
            
            // Verificar se alguma palavra-chave está na pergunta
            if (palavrasChave.some(palavra => pergunta.includes(palavra))) {
                client.sendText(numeroContato, faq.resposta);
                return;
            }
        }

        // Se não encontrou resposta, enviar mensagem padrão
    });
}

pool.getConnection((err, connection) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err);
    } else {
        console.log('✅ Conectado ao banco de dados MySQL');
        connection.release();
    }
});

wppconnect.create({
    session: 'whatsapp-session',
    authTimeout: 60,
    headless: true
}).then(client => {
    console.log('✅ Conectado ao WhatsApp!');

    // Executar verificação a cada 30 segundos
    setInterval(() => verificarCarrinhosAbandonados(client), 30000);

    client.onMessage(async message => {
        console.log('📩 Mensagem recebida:', message.body);
        const numeroContato = message.from;

        // Atualizar último acesso do usuário
        const sqlAtualizarAcesso = 'UPDATE Usuarios SET ultimo_acesso = NOW() WHERE telefone = ?';
        pool.query(sqlAtualizarAcesso, [numeroContato]);

        // Responder perguntas frequentes
        await responderFAQ(message, client);

        // 📌 Listar Usuários
        if (message.body.trim().toLowerCase().includes("listar")) {
            const sqlList = 'SELECT * FROM Usuarios';
            pool.query(sqlList, (err, results) => {
                if (err) {
                    console.error('Erro ao listar Usuários:', err);
                    client.sendText(numeroContato, '❌ Erro ao listar Usuários. Tente novamente.');
                } else {
                    if (results.length === 0) {
                        client.sendText(numeroContato, '📭 Nenhum usuário encontrado.');
                    } else {
                        let response = '👤 Usuários:\n';
                        results.forEach((usuario, index) => {
                            response += `\n🆔 ID: ${index + 1}` +
                                        `\n📌 Nome: ${usuario.nome}` +
                                        `\n📞 Telefone: ${usuario.telefone}` +
                                        `\n🔄 Lembretes: ${usuario.carrinho_lembrado}\n`;
                        });
                        client.sendText(numeroContato, response);
                    }
                }
            });
            return;
        }

        if (message.body.trim().toLowerCase().includes("teste")){
            client.sendText(numeroContato, '✅ Funcionando!');
        }
    });
}).catch(err => {
    console.error('❌ Erro ao conectar ao WhatsApp:', err);
});