import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../shared/schema';

console.log('Running database push...');

// This script will push the schema to the database
async function main() {
  const connectionString = process.env.DATABASE_URL!;
  
  if (!connectionString) {
    console.error('DATABASE_URL is not defined');
    process.exit(1);
  }
  
  // Create a postgres client for migrations
  const migrationClient = postgres(connectionString, { max: 1 });
  
  // Create a drizzle instance using our schema
  const db = drizzle(migrationClient, { schema });
  
  console.log('Pushing schema to database...');
  
  try {
    // Push the schema to the database
    await migrate(db, { migrationsFolder: 'drizzle' });
    
    console.log('Schema push completed successfully!');
  } catch (error) {
    console.error('Error pushing schema:', error);
    process.exit(1);
  } finally {
    // Close the database connection
    await migrationClient.end();
  }
}

main();