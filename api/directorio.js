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
        console.error('Error registrando movimiento en directorio:', err);
    }
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
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM directorio_clientes ORDER BY nombre ASC');
            return res.status(200).json(result.rows);
        }

        if (req.method === 'POST') {
            const { nombre, logo_url } = req.body;
            if (!nombre || !logo_url) return res.status(400).json({ error: 'Nombre y logo son obligatorios' });

            const result = await pool.query(
                'INSERT INTO directorio_clientes (nombre, logo_url) VALUES ($1, $2) RETURNING *',
                [nombre.trim(), logo_url]
            );

            await registrarMovimiento(
                usuarioActivo,
                'CREAR',
                'Directorio Empresas',
                `Empresa agregada: ${nombre.trim()}`,
                `Logo oficial cargado en directorio`
            );

            return res.status(201).json(result.rows[0]);
        }

        if (req.method === 'DELETE') {
            const { id } = req.body;
            const prevRes = await pool.query('SELECT * FROM directorio_clientes WHERE id = $1', [id]);
            await pool.query('DELETE FROM directorio_clientes WHERE id = $1', [id]);

            if (prevRes.rows.length > 0) {
                await registrarMovimiento(
                    usuarioActivo,
                    'ELIMINAR',
                    'Directorio Empresas',
                    `Empresa eliminada del directorio: ${prevRes.rows[0].nombre}`,
                    `Registro eliminado permanentemente`
                );
            }

            return res.status(200).json({ message: 'Empresa eliminada' });
        }

        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error('🚨 ERROR EN API DIRECTORIO:', error);
        return res.status(500).json({ error: 'Error interno en el servidor', detalle: error.message });
    }
}
