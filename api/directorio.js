import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // Traer todos los clientes del directorio permanente
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM directorio_clientes ORDER BY nombre ASC');
            return res.status(200).json(result.rows);
        }
        
        // Guardar un cliente nuevo en el directorio
        if (req.method === 'POST') {
            const { nombre, logo_url } = req.body;
            
            if (!nombre || !logo_url) {
                return res.status(400).json({ error: 'Nombre y Logo son obligatorios para el directorio.' });
            }

            const result = await pool.query(
                'INSERT INTO directorio_clientes (nombre, logo_url) VALUES ($1, $2) RETURNING *',
                [nombre, logo_url]
            );
            return res.status(201).json(result.rows[0]);
        }
        
        // Borrar un cliente del directorio
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM directorio_clientes WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente eliminado del directorio' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
    } catch (error) {
        console.error("🚨 ERROR EN API DIRECTORIO:", error);
        return res.status(500).json({ error: 'Error interno', detalle: error.message });
    }
}