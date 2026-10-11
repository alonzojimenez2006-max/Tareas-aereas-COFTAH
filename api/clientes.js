import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            const result = await pool.query('SELECT * FROM clientes_agenda ORDER BY fecha_atencion ASC');
            return res.status(200).json(result.rows);
        }
        
        if (req.method === 'POST') {
            console.log("1. Recibiendo petición de nuevo cliente...");
            console.log("2. Datos recibidos del formulario:", req.body);
            
            const { fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus } = req.body;
            
            const result = await pool.query(
                `INSERT INTO clientes_agenda (fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus) 
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                [fecha_atencion, logo_url, nombre_cliente, lugar_atencion, curso, facilitador, estatus]
            );
            
            console.log("3. Cliente guardado con éxito en Neon.");
            return res.status(201).json(result.rows[0]);
        }
        
        if (req.method === 'DELETE') {
            const { id } = req.body;
            await pool.query('DELETE FROM clientes_agenda WHERE id = $1', [id]);
            return res.status(200).json({ message: 'Cliente borrado' });
        }
        
        return res.status(405).json({ error: 'Método no permitido' });
        
    } catch (error) {
        // ESTA LÍNEA ES LA CLAVE: Forzará a Vercel a mostrar el error en rojo en la pestaña de Logs
        console.error("🚨 ERROR GRAVE EN BASE DE DATOS (CLIENTES):", error);
        
        return res.status(500).json({ 
            error: 'Error interno', 
            mensaje_exacto: error.message,
            detalle: error.detail
        });
    }
}
