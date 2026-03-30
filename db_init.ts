import { createClient } from '@vercel/postgres';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function initDb() {
  const client = createClient({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
  
  try {
    await client.connect();
    console.log('Initializing database tables...');
    
    // Newsletters table
    await client.sql`
      CREATE TABLE IF NOT EXISTS newsletters (
        id VARCHAR(100) PRIMARY KEY,
        subject VARCHAR(255),
        category VARCHAR(100),
        sent_at TIMESTAMP,
        status VARCHAR(50),
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        recipients JSONB DEFAULT '[]',
        opened_by JSONB DEFAULT '[]',
        clicked_by JSONB DEFAULT '[]',
        intro_text TEXT,
        image_data TEXT,
        embed_url TEXT
      );
    `;
    console.log('✅ Created newsletters table');

    // Automated Templates table
    await client.sql`
      CREATE TABLE IF NOT EXISTS automated_templates (
        id VARCHAR(100) PRIMARY KEY,
        subject VARCHAR(255),
        blocks JSONB DEFAULT '[]'
      );
    `;
    console.log('✅ Created automated_templates table');

    // Automation Logs table
    await client.sql`
      CREATE TABLE IF NOT EXISTS automation_logs (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(100),
        customer_email VARCHAR(255),
        template_id VARCHAR(100),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('✅ Created automation_logs table');
    
    console.log('Database initialization complete!');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    await client.end();
  }
}

initDb();
