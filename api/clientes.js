import pkg from 'pg';
const { Pool } = pkg;

// Configuración de la conexión usando la variable de entorno oculta
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export default async function handler(req, res) {
    // Definir los encabezados (CORS) para permitir que el frontend se comunique
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        // MÉTODO GET: Leer los clientes para mostrarlos en el index.html
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM clientes_agenda ORDER BY fecha_atencion ASC');
            return res.status(200).json(result.rows);
        }

        // MÉTODO POST: Guardar un nuevo cliente desde el admin.html
        if (req.method === 'POST') {
            const { fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus } = req.body;
            
            const result = await pool.query(
                `INSERT INTO clientes_agenda 
                (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus]
            );
            return res.status(201).json(result.rows[0]);
        }

        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        console.error("Error en la base de datos:", error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
}