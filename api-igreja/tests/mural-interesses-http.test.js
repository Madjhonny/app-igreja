const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile, mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const dbUrl = process.env.INTERESSES_TEST_DATABASE_URL;

test('HTTP + PostgreSQL real: interesses privados', {
    skip: !dbUrl,
    timeout: 90000
}, async t => {
    const url = new URL(dbUrl);

    assert.ok(
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        url.pathname === '/agenda_interesses_test' &&
        !url.search && !url.hash,
        'Somente banco local isolado permitido.'
    );

    const schema = 'interesses_http_' +
        crypto.randomBytes(8).toString('hex');

    const pool = new Pool({
        connectionString: dbUrl,
        options: `-c search_path=${schema}`
    });

    let child;
    let tempDir;
    let created = false;

    const query = (sql, params) => pool.query(sql, params);

    try {
        assert.equal(
            (await query('SELECT current_database() AS name')).rows[0].name,
            'agenda_interesses_test'
        );

        await query(`CREATE SCHEMA "${schema}"`);
        created = true;

        for (const filename of [
            '001_initial_schema.sql',
            '003_password_recovery.sql',
            '20261124_mural_interesses.sql'
        ]) {
            const sql = await readFile(
                path.join(__dirname, '../migrations', filename),
                'utf8'
            );

            const client = await pool.connect();

            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }

        const congregation = (await query(`
            INSERT INTO congregacoes (nome)
            VALUES ('Congregacao teste')
            RETURNING id
        `)).rows[0].id;

        const senha = 'TesteLocal123!';
        const hash = await bcrypt.hash(senha, 4);

        const addUser = async (name, role, status, cpf) =>
            (await query(`
                INSERT INTO usuarios
                    (nome_completo, nome_exibicao, email,
                     senha_hash, congregacao_id, cpf,
                     nivel_acesso, status_conta)
                VALUES ($1,$1,$2,$3,$4,$5,$6,$7)
                RETURNING id
            `, [
                name, `${name}@example.test`,
                hash, congregation, cpf, role, status
            ])).rows[0].id;

        const masterId = await addUser(
            'master', 'MASTER', 'APROVADO', '10000000001'
        );

        const adminId = await addUser(
            'admin', 'ADMIN', 'APROVADO', '10000000002'
        );

        const memberId = await addUser(
            'member', 'MEMBRO', 'APROVADO', '10000000003'
        );

        const pendingId = await addUser(
            'pending', 'MEMBRO', 'PENDENTE', '10000000004'
        );

        const addPost = async (title, expired = false) =>
            (await query(`
                INSERT INTO mural_eventos
                    (usuario_id, congregacao_id, titulo,
                     tipo_midia, midia, data_inicio, data_fim)
                VALUES (
                    $1,$2,$3,'imagem',
                    'https://example.test/image.png',
                    CURRENT_DATE + $4::integer,
                    CURRENT_DATE + $5::integer
                )
                RETURNING id
            `, [
                masterId, congregation, title,
                expired ? -10 : 0,
                expired ? -1 : 30
            ])).rows[0].id;

        const first = await addPost('Evento A');
        const second = await addPost('Evento B');
        const expired = await addPost('Evento encerrado', true);

        // Diretorio vazio: nao carrega o .env do projeto.
        tempDir = await mkdtemp(
            path.join(tmpdir(), 'agenda-interesses-http-')
        );

        child = spawn(process.execPath, ['-e', `
            global.fetch = async () => {
                throw new Error('Rede externa bloqueada no teste');
            };

            const pg = require(
                require.resolve('pg', {
                    paths: [process.argv[1]]
                })
            );

            const OriginalPool = pg.Pool;

            pg.Pool = class extends OriginalPool {
                constructor(config) {
                    super({
                        ...config,
                        options: process.env.TEST_PG_OPTIONS
                    });
                }
            };

            require(process.argv[1]);
        `, path.join(__dirname, '../server.js')], {
            cwd: tempDir,
            env: {
                PORT: '0',
                DB_HOST: url.hostname,
                DB_PORT: url.port || '5432',
                DB_NAME: 'agenda_interesses_test',
                DB_USER: decodeURIComponent(url.username),
                DB_PASSWORD: decodeURIComponent(url.password),
                DB_SSL: 'false',
                TEST_PG_OPTIONS: `-c search_path=${schema}`,
                JWT_SECRET: 'interesses-http-test-only',
                PUSH_NOTIFICATIONS_ENABLED: 'false',
                CORS_ORIGINS: 'https://test.example.test',
                NODE_ENV: 'test'
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let logs = '';

        child.stderr.on('data', chunk => {
            logs += chunk;
        });

        const port = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Servidor nao iniciou: ' + logs));
            }, 15000);

            child.once('error', error => {
                clearTimeout(timer);
                reject(error);
            });

            child.once('exit', code => {
                clearTimeout(timer);
                reject(new Error('Servidor encerrou: ' + code));
            });

            child.stdout.on('data', chunk => {
                logs += chunk;

                const match = /rodando na porta (\d+)!/.exec(logs);

                if (match) {
                    clearTimeout(timer);
                    resolve(Number(match[1]));
                }
            });
        });

        const request = async (
            route, method = 'GET', token, body
        ) => {
            const response = await fetch(
                `http://127.0.0.1:${port}${route}`,
                {
                    method,
                    headers: {
                        ...(token ? {
                            Authorization: `Bearer ${token}`
                        } : {}),
                        ...(body ? {
                            'Content-Type': 'application/json'
                        } : {})
                    },
                    body: body ? JSON.stringify(body) : undefined,
                    signal: AbortSignal.timeout(10000)
                }
            );

            return {
                status: response.status,
                data: await response.json(),
                cache: response.headers.get('cache-control')
            };
        };

        const login = async name => {
            const result = await request('/login', 'POST', null, {
                email: `${name}@example.test`,
                senha
            });

            assert.equal(result.status, 200);
            assert.ok(result.data.token);

            return result.data.token;
        };

        const master = await login('master');
        const admin = await login('admin');
        const member = await login('member');
        const pending = await login('pending');

        const list = token =>
            request('/mural/interesses', 'GET', token);

        const mark = (token, id, body) =>
            request(`/mural/${id}/interesse`, 'PUT', token, body);

        const unmark = (token, id, body) =>
            request(`/mural/${id}/interesse`, 'DELETE', token, body);

        const ids = async token => {
            const result = await list(token);

            assert.equal(result.status, 200);
            assert.equal(result.cache, 'no-store');

            return result.data.post_ids;
        };

        const count = async (user, post) =>
            Number((await query(`
                SELECT COUNT(*) FROM mural_interesses
                WHERE usuario_id=$1 AND post_id=$2
            `, [user, post])).rows[0].count);

        await t.test('servidor local saudavel', async () => {
            assert.equal((await request('/health')).status, 200);
        });

        await t.test('interesses inicialmente vazios', async () => {
            for (const token of [master, admin, member]) {
                assert.deepEqual(await ids(token), []);
            }
        });

        await t.test('convidado e pendente nao acessam', async () => {
            for (const [token, status] of [
                [undefined, 401],
                [pending, 403]
            ]) {
                assert.equal((await list(token)).status, status);
                assert.equal((await mark(token, first)).status, status);
                assert.equal((await unmark(token, first)).status, status);
            }

            assert.equal(await count(pendingId, first), 0);
        });

        await t.test('MASTER, ADMIN e MEMBRO podem marcar', async () => {
            for (const [token, user] of [
                [master, masterId],
                [admin, adminId],
                [member, memberId]
            ]) {
                const result = await mark(token, first);

                assert.equal(result.status, 200);
                assert.equal(result.cache, 'no-store');

                assert.deepEqual(result.data, {
                    post_id: first,
                    interesse: true
                });

                assert.equal(await count(user, first), 1);
            }
        });

        await t.test('marcacao repetida preserva registro e data', async () => {
            const read = async () => (await query(`
                SELECT criado_em FROM mural_interesses
                WHERE usuario_id=$1 AND post_id=$2
            `, [memberId, first])).rows[0].criado_em.getTime();

            const original = await read();

            assert.equal((await mark(member, first)).status, 200);
            assert.equal(await count(memberId, first), 1);
            assert.equal(await read(), original);
        });

        await t.test('dez marcacoes simultaneas sem duplicatas', async () => {
            const results = await Promise.all(
                Array.from({ length: 10 }, () => mark(member, second))
            );

            assert.ok(results.every(r =>
                r.status === 200 && r.data.interesse === true
            ));

            assert.equal(await count(memberId, second), 1);
        });

        await t.test('isolamento entre usuarios e novo login', async () => {
            assert.deepEqual(await ids(master), [first]);
            assert.deepEqual(await ids(admin), [first]);

            assert.deepEqual(
                (await ids(member)).sort((a,b) => a-b),
                [first, second].sort((a,b) => a-b)
            );

            assert.deepEqual(
                (await ids(await login('member'))).sort((a,b) => a-b),
                [first, second].sort((a,b) => a-b)
            );
        });

        await t.test('identidade enviada pelo cliente e ignorada', async () => {
            const result = await mark(admin, second, {
                usuario_id: masterId,
                post_id: first
            });

            assert.equal(result.status, 200);
            assert.equal(await count(adminId, second), 1);
            assert.equal(await count(masterId, second), 0);

            assert.equal((await unmark(admin, second, {
                usuario_id: memberId
            })).status, 200);

            assert.equal(await count(memberId, second), 1);
        });

        await t.test('desmarcacao repetida e privada', async () => {
            for (let i = 0; i < 2; i++) {
                const result = await unmark(member, first);

                assert.equal(result.status, 200);
                assert.equal(result.cache, 'no-store');

                assert.deepEqual(result.data, {
                    post_id: first,
                    interesse: false
                });
            }

            assert.equal(await count(memberId, first), 0);
            assert.equal(await count(masterId, first), 1);
            assert.equal(await count(adminId, first), 1);
        });

        await t.test('publicacao inexistente ou encerrada', async () => {
            assert.equal(
                (await mark(member, 2147483647)).status, 404
            );

            assert.equal((await mark(member, expired)).status, 404);

            await query(`
                INSERT INTO mural_interesses (usuario_id, post_id)
                VALUES ($1,$2)
            `, [memberId, expired]);

            assert.ok(!(await ids(member)).includes(expired));
            assert.equal((await unmark(member, expired)).status, 200);
            assert.equal(await count(memberId, expired), 0);
        });

        await t.test('identificadores invalidos', async () => {
            for (const id of [
                '0', '-1', '1.5', '1e2',
                '02', 'abc', '2147483648'
            ]) {
                assert.equal((await mark(member, id)).status, 400);
                assert.equal((await unmark(member, id)).status, 400);
            }
        });

        await t.test('falha na tabela de interesses retorna erro controlado', async () => {
            await query(`
                ALTER TABLE mural_interesses
                RENAME TO mural_interesses_indisponivel
            `);

            try {
                for (const result of [
                    await list(member),
                    await mark(member, first),
                    await unmark(member, second)
                ]) {
                    assert.equal(result.status, 500);
                    assert.equal(result.cache, 'no-store');
                    assert.deepEqual(Object.keys(result.data), ['erro']);
                    assert.ok(!result.data.erro.includes('mural_interesses'));
                }
            } finally {
                await query(`
                    ALTER TABLE mural_interesses_indisponivel
                    RENAME TO mural_interesses
                `);
            }

            assert.equal(await count(memberId, second), 1);
            assert.deepEqual(await ids(member), [second]);
        });

        await t.test('revogacao de acesso com token existente', async () => {
            for (const status of ['BLOQUEADO', 'RECUSADO', 'PENDENTE']) {
                await query(`
                    UPDATE usuarios SET status_conta=$1 WHERE id=$2
                `, [status, memberId]);

                assert.equal((await list(member)).status, 403);
                assert.equal((await mark(member, first)).status, 403);
                assert.equal((await unmark(member, second)).status, 403);
            }

            await query(`
                UPDATE usuarios SET status_conta='APROVADO' WHERE id=$1
            `, [memberId]);

            assert.deepEqual(await ids(member), [second]);
        });

        await t.test('exclusao de publicacao remove interesses', async () => {
            const result = await request(
                `/mural/${first}`, 'DELETE', master
            );

            assert.equal(result.status, 200);

            assert.equal(Number((await query(`
                SELECT COUNT(*) FROM mural_interesses
                WHERE post_id=$1
            `, [first])).rows[0].count), 0);

            assert.deepEqual(await ids(master), []);
            assert.deepEqual(await ids(admin), []);
            assert.equal((await mark(member, first)).status, 404);
        });

        await t.test('mural publico nao divulga interesses', async () => {
            const result = await request('/publico/mural');

            assert.equal(result.status, 200);

            const post = result.data.find(row => row.id === second);

            assert.ok(post);

            for (const key of Object.keys(post)) {
                assert.ok(!/interesse/i.test(key));
            }
        });

    } finally {
        try {
            if (child && child.pid &&
                child.exitCode === null &&
                child.signalCode === null) {
                const exited = once(child, 'exit');
                child.kill();
                await exited;
            }
        } finally {
            try {
                if (created) {
                    await query(`DROP SCHEMA "${schema}" CASCADE`);
                }
            } finally {
                await pool.end();

                if (tempDir) {
                    await rm(tempDir, {
                        recursive: true,
                        force: true
                    });
                }
            }
        }
    }
});