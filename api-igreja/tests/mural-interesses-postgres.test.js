const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { validarBancoLocal } = require('../scripts/banco-local-de-teste');

const dbUrl = process.env.INTERESSES_TEST_DATABASE_URL;

test('PostgreSQL real: integridade dos interesses', {
    skip: !dbUrl,
    timeout: 60000
}, async t => {
    validarBancoLocal(dbUrl, 'agenda_interesses_test');

    const schema = 'interesses_' + crypto.randomBytes(8).toString('hex');

    const pool = new Pool({
        connectionString: dbUrl,
        options: `-c search_path=${schema}`
    });

    const query = (sql, params) => pool.query(sql, params);

    const migration = filename => readFile(
        path.join(__dirname, '../migrations', filename),
        'utf8'
    );

    const addUser = async suffix => {
        const result = await query(`
            INSERT INTO usuarios
                (nome_completo, nome_exibicao, email,
                 senha_hash, cpf, status_conta)
            VALUES ('Teste', 'Teste', $1, 'test-only', $2, 'APROVADO')
            RETURNING id
        `, [
            `interesse-${suffix}@example.test`,
            String(suffix).padStart(11, '0')
        ]);

        return result.rows[0].id;
    };

    const addPost = async owner => {
        const result = await query(`
            INSERT INTO mural_eventos
                (usuario_id, titulo, data_inicio, data_fim)
            VALUES ($1, 'Teste', CURRENT_DATE, CURRENT_DATE + 1)
            RETURNING id
        `, [owner]);

        return result.rows[0].id;
    };

    const insert = (user, post) => query(`
        INSERT INTO mural_interesses (usuario_id, post_id)
        VALUES ($1, $2)
    `, [user, post]);

    const count = async () => Number(
        (await query('SELECT COUNT(*) FROM mural_interesses'))
            .rows[0].count
    );

    const applyMigration = async () => {
        const sql = await migration(
            '20261124_mural_interesses.sql'
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
    };

    let created = false;

    try {
        const database = await query('SELECT current_database() AS name');
        assert.equal(database.rows[0].name, 'agenda_interesses_test');

        await query(`CREATE SCHEMA "${schema}"`);
        created = true;

        await query(await migration('001_initial_schema.sql'));

        await t.test('aplica a migracao', async () => {
            await applyMigration();
            assert.equal(await count(), 0);
        });

        await t.test('reaplica a migracao sem erro', async () => {
            await applyMigration();
            assert.equal(await count(), 0);
        });

        const owner = await addUser(1);
        const member = await addUser(2);
        const other = await addUser(3);
        const post = await addPost(owner);

        await t.test('persiste interesse', async () => {
            await insert(member, post);
            assert.equal(await count(), 1);

            const result = await query(`
                SELECT usuario_id, post_id, criado_em
                FROM mural_interesses
            `);

            assert.equal(result.rows[0].usuario_id, member);
            assert.equal(result.rows[0].post_id, post);
            assert.ok(result.rows[0].criado_em instanceof Date);
        });

        await t.test('rejeita interesse duplicado', async () => {
            await assert.rejects(
                insert(member, post),
                { code: '23505' }
            );

            assert.equal(await count(), 1);
        });

        await t.test('rejeita usuario inexistente', async () => {
            await assert.rejects(
                insert(2147483647, post),
                { code: '23503' }
            );
        });

        await t.test('rejeita publicacao inexistente', async () => {
            await assert.rejects(
                insert(member, 2147483647),
                { code: '23503' }
            );
        });

        await t.test('permite usuarios distintos no mesmo post', async () => {
            await insert(other, post);
            assert.equal(await count(), 2);
        });

        await t.test('rollback nao deixa registro residual', async () => {
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                await client.query(`
                    INSERT INTO mural_interesses
                        (usuario_id, post_id)
                    VALUES ($1, $2)
                `, [owner, post]);
            } finally {
                try {
                    await client.query('ROLLBACK');
                } finally {
                    client.release();
                }
            }

            assert.equal(await count(), 2);
        });

        await t.test('concorrencia nao gera duplicatas', async () => {
            const results = await Promise.all(
                Array.from({ length: 10 }, () => query(`
                    INSERT INTO mural_interesses
                        (usuario_id, post_id)
                    VALUES ($1, $2)
                    ON CONFLICT (usuario_id, post_id)
                    DO NOTHING
                `, [owner, post]))
            );

            assert.equal(
                results.reduce((sum, result) => sum + result.rowCount, 0),
                1
            );

            assert.equal(await count(), 3);
        });

        await t.test('exclusao do usuario remove apenas seus interesses', async () => {
            await query(
                'DELETE FROM usuarios WHERE id = $1',
                [other]
            );

            assert.equal(await count(), 2);

            const result = await query(`
                SELECT usuario_id
                FROM mural_interesses
                ORDER BY usuario_id
            `);

            assert.deepEqual(
                result.rows.map(row => row.usuario_id),
                [owner, member].sort((a, b) => a - b)
            );
        });

        await t.test('exclusao do post remove interesses associados', async () => {
            const anotherPost = await addPost(owner);
            await insert(member, anotherPost);

            await query(
                'DELETE FROM mural_eventos WHERE id = $1',
                [post]
            );

            assert.equal(await count(), 1);

            const result = await query(
                'SELECT post_id FROM mural_interesses'
            );

            assert.equal(result.rows[0].post_id, anotherPost);
        });

    } finally {
        try {
            if (created) {
                await query(`DROP SCHEMA "${schema}" CASCADE`);
            }
        } finally {
            await pool.end();
        }
    }
});
