import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function registrarMovimiento(usuario, accion, modulo, resumen, cambiosDetalle = '') {
    try {
        await pool.query(
            `INSERT INTO historial_movimientos (usuario, accion, modulo, resumen, cambios_detalle, fecha_hora)
             VALUES ($1, $2, $3, $4, $5, NOW() AT TIME ZONE 'America/Caracas')`,
            [usuario || 'Admin', accion, modulo, resumen, cambiosDetalle]
        );
    } catch (err) {
        console.error('Error registrando movimiento en formaciones:', err);
    }
}

async function resolverTablaFormaciones() {
    const tablasRes = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('formaciones', 'acciones_formacion', 'catalogo_formaciones', 'cursos')
    `);

    const candidatas = ['formaciones', 'acciones_formacion', 'catalogo_formaciones', 'cursos'];
    const existentes = tablasRes.rows.map(r => r.table_name);
    let tabla = candidatas.find(t => existentes.includes(t));

    if (!tabla) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS formaciones (
                id SERIAL PRIMARY KEY,
                nombre VARCHAR(255) NOT NULL
            )
        `);
        return { tabla: 'formaciones', columna: 'nombre' };
    }

    const colsRes = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
    `, [tabla]);

    const cols = colsRes.rows.map(r => r.column_name);
    const colCandidatas = ['nombre', 'nombre_formacion', 'accion_formacion', 'titulo', 'descripcion'];
    const columna = colCandidatas.find(c => cols.includes(c)) || cols.find(c => c !== 'id') || 'nombre';

    return { tabla, columna };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-nombre, x-user-rol');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const usuarioActivo = req.body?.usuario_solicitante || req.headers['x-user-nombre'] || 'Admin';

    try {
        const { tabla, columna } = await resolverTablaFormaciones();

        if (req.method === 'GET') {
            const result = await pool.query(
                `SELECT id, "${columna}" AS nombre FROM "${tabla}" ORDER BY "${columna}" ASC`
            );
            return res.status(200).json(result.rows);
        }

        if (req.method === 'POST') {
            const { nombre } = req.body;
            if (!nombre) return res.status(400).json({ error: 'El nombre de la formación es obligatorio' });

            const result = await pool.query(
                `INSERT INTO "${tabla}" ("${columna}") VALUES ($1) RETURNING id, "${columna}" AS nombre`,
                [nombre.trim()]
            );

            await registrarMovimiento(
                usuarioActivo,
                'CREAR',
                'Directorio Formaciones',
                `Acción de formación agregada: ${nombre.trim()}`,
                `Registrada en el catálogo permanente`
            );

            return res.status(201).json(result.rows[0]);
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            const prevRes = await pool.query(`SELECT id, "${columna}" AS nombre FROM "${tabla}" WHERE id = $1`, [id]);
            await pool.query(`DELETE FROM "${tabla}" WHERE id = $1`, [id]);

            if (prevRes.rows.length > 0) {
                await registrarMovimiento(
                    usuarioActivo,
                    'ELIMINAR',
                    'Directorio Formaciones',
                    `Acción de formación eliminada: ${prevRes.rows[0].nombre}`,
                    `Eliminada del catálogo`
                );
            }

            return res.status(200).json({ message: 'Formación eliminada' });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('🚨 ERROR EN API FORMACIONES:', error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
