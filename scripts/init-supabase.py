#!/usr/bin/env python3
"""
Firecrawl Supabase Database Initialization Script

This script initializes the Supabase database with all required tables
for Firecrawl to function properly using direct PostgreSQL connection.

Usage:
    # Full initialization (runs all migration scripts)
    python scripts/init-supabase.py

    # Run a specific migration script
    python scripts/init-supabase.py --migration 01-add-team-fields.sql

    # List available migration scripts
    python scripts/init-supabase.py --list

Environment Variables Required:
    - SUPABASE_URL
    - SUPABASE_SERVICE_TOKEN
    - SUPABASE_POSTGRES_HOST
    - SUPABASE_POSTGRES_USER
    - SUPABASE_POSTGRES_PASSWORD
"""

import os
import re
import sys
import argparse
from pathlib import Path
import psycopg2
from dotenv import load_dotenv

# ANSI color codes for terminal output
class Colors:
    RESET = '\x1b[0m'
    BRIGHT = '\x1b[1m'
    RED = '\x1b[31m'
    GREEN = '\x1b[32m'
    YELLOW = '\x1b[33m'
    BLUE = '\x1b[34m'
    CYAN = '\x1b[36m'

def log(message, color='RESET'):
    print(f"{getattr(Colors, color)}{message}{Colors.RESET}")

def error(message):
    log(f"ERROR: {message}", 'RED')

def success(message):
    log(f"✓ {message}", 'GREEN')

def info(message):
    log(f"ℹ {message}", 'CYAN')

def warn(message):
    log(f"⚠ {message}", 'YELLOW')

def get_connection_string(db_host, db_user, db_password):
    """
    Construct PostgreSQL connection string using custom host.

    PostgreSQL connection string: postgresql://[user]:[password]@[host]:5432/postgres
    """
    # Construct PostgreSQL connection string with custom host
    connection_string = f"postgresql://{db_user}:{db_password}@{db_host}:5432/postgres"
    return connection_string

def get_migration_scripts():
    """Get all migration scripts sorted by filename."""
    scripts_dir = Path(__file__).parent
    scripts = sorted(scripts_dir.glob('*.sql'))
    return scripts

def list_migrations():
    """List all available migration scripts."""
    scripts = get_migration_scripts()
    log('\nAvailable migration scripts:', 'BRIGHT')
    log('-' * 60 + '\n')
    for script in scripts:
        log(f'  {script.name}')
    print()

def create_migrations_table(cursor):
    """Create migrations table if it doesn't exist."""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            id SERIAL PRIMARY KEY,
            filename VARCHAR(255) UNIQUE NOT NULL,
            executed_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_filename
        ON public.schema_migrations(filename)
    """)

def is_migration_executed(cursor, filename):
    """Check if a migration has already been executed."""
    cursor.execute("""
        SELECT 1 FROM public.schema_migrations
        WHERE filename = %s
    """, (filename,))
    return cursor.fetchone() is not None

def record_migration(cursor, filename):
    """Record that a migration has been executed."""
    cursor.execute("""
        INSERT INTO public.schema_migrations (filename)
        VALUES (%s)
    """, (filename,))

def execute_sql_file(cursor, sql_file_path):
    """Execute a single SQL file."""
    try:
        sql_content = sql_file_path.read_text()
        info(f"Executing: {sql_file_path.name}")
    except Exception as e:
        error(f"Failed to read SQL file: {e}")
        return False

    # Split SQL into individual statements, handling dollar-quoted strings
    statements = []
    current_statement = []
    in_dollar_string = False
    dollar_depth = 0
    
    for line in sql_content.split('\n'):
        stripped = line.strip()
        # Skip empty lines and comments
        if not stripped or stripped.startswith('--'):
            if current_statement and not in_dollar_string:
                statements.append('\n'.join(current_statement))
                current_statement = []
            continue
        
        current_statement.append(line)
        
        # Track dollar-quoted string delimiters
        if '$$' in line:
            # Count occurrences of $$
            dollar_count = line.count('$$')
            # Toggle state for each pair
            for _ in range(dollar_count):
                if in_dollar_string:
                    dollar_depth -= 1
                    if dollar_depth == 0:
                        in_dollar_string = False
                else:
                    dollar_depth += 1
                    in_dollar_string = True
        
        # Check if line ends with semicolon and we're not inside a dollar-quoted string
        if stripped.endswith(';') and not in_dollar_string:
            statements.append('\n'.join(current_statement))
            current_statement = []

    if current_statement:
        statements.append('\n'.join(current_statement))

    # Execute each statement separately
    executed_count = 0
    skipped_count = 0
    error_count = 0

    for i, statement in enumerate(statements):
        if not statement.strip() or statement.strip().startswith('--'):
            continue

        try:
            cursor.execute(statement)
            executed_count += 1
        except psycopg2.Error as e:
            if "already exists" in str(e):
                skipped_count += 1
            else:
                error_count += 1
                warn(f"Error executing statement {i+1}: {e}")

    if error_count > 0:
        warn(f'There were {error_count} errors during SQL execution.')
        return False

    success(f'Executed: {executed_count} statements, {skipped_count} skipped')
    return True

def main():
    parser = argparse.ArgumentParser(description='Firecrawl Supabase Database Initialization')
    parser.add_argument('--list', action='store_true', help='List available migration scripts')
    parser.add_argument('--migration', type=str, help='Run a specific migration script')
    args = parser.parse_args()

    # Handle --list option
    if args.list:
        list_migrations()
        return

    log('\n' + '=' * 60, 'BRIGHT')
    log('Firecrawl Supabase Database Initialization', 'BRIGHT')
    log('=' * 60 + '\n', 'BRIGHT')

    # Load environment variables
    env_path = Path(__file__).parent.parent / '.env'
    load_dotenv(env_path)

    # Check environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_service_token = os.getenv('SUPABASE_SERVICE_TOKEN')
    supabase_postgres_host = os.getenv('SUPABASE_POSTGRES_HOST')
    supabase_postgres_user = os.getenv('SUPABASE_POSTGRES_USER')
    supabase_postgres_password = os.getenv('SUPABASE_POSTGRES_PASSWORD')
    
    if not supabase_url:
        error('Missing required environment variable: SUPABASE_URL')
        log('Please set this variable in your .env file and try again.\n')
        sys.exit(1)
    
    if not supabase_service_token:
        error('Missing required environment variable: SUPABASE_SERVICE_TOKEN')
        log('Please set this variable in your .env file and try again.\n')
        sys.exit(1)
    
    if not supabase_postgres_host:
        error('Missing required environment variable: SUPABASE_POSTGRES_HOST')
        log('Please set this variable in your .env file and try again.\n')
        log('Example: SUPABASE_POSTGRES_HOST=aws-1-ap-northeast-1.pooler.supabase.com\n')
        sys.exit(1)
    
    if not supabase_postgres_user:
        error('Missing required environment variable: SUPABASE_POSTGRES_USER')
        log('Please set this variable in your .env file and try again.\n')
        sys.exit(1)
    
    if not supabase_postgres_password:
        error('Missing required environment variable: SUPABASE_POSTGRES_PASSWORD')
        log('Please set this variable in your .env file and try again.\n')
        log('You can find your database credentials in Supabase Dashboard:')
        log('  1. Go to your project settings')
        log('  2. Navigate to Database > Connection string')
        log('  3. Copy the username and password from the connection string\n')
        sys.exit(1)

    # Determine which migration(s) to run
    migration_scripts = []
    if args.migration:
        # Run specific migration
        migration_file = Path(__file__).parent / args.migration
        if not migration_file.exists():
            error(f"Migration file not found: {migration_file}")
            sys.exit(1)
        migration_scripts = [migration_file]
        info(f"Running specific migration: {args.migration}")
    else:
        # Run all migrations
        migration_scripts = get_migration_scripts()
        info(f"Running all {len(migration_scripts)} migration scripts")
    
    # Get connection string
    try:
        connection_string = get_connection_string(supabase_postgres_host, supabase_postgres_user, supabase_postgres_password)
        info(f'Constructed PostgreSQL connection string using host: {supabase_postgres_host}')
    except ValueError as e:
        error(str(e))
        sys.exit(1)
    
    # Connect to database
    log('\n' + '-' * 60)
    log('Connecting to Supabase PostgreSQL...', 'BRIGHT')
    log('-' * 60 + '\n')
    
    conn = None
    cursor = None
    try:
        conn = psycopg2.connect(connection_string)
        conn.autocommit = True
        cursor = conn.cursor()
        success('Successfully connected to Supabase PostgreSQL')
    except psycopg2.OperationalError as e:
        error(f"Connection failed: {e}")
        log('\nPlease verify:')
        log('  - SUPABASE_POSTGRES_PASSWORD is correct')
        log('  - Your IP is allowed in Supabase Dashboard > Database > Connection pooling')
        log('  - Supabase project is active\n')
        sys.exit(1)
    except Exception as e:
        error(f"Connection error: {e}")
        sys.exit(1)
    
    # Execute SQL
    log('\n' + '-' * 60)
    log('Executing migration scripts', 'BRIGHT')
    log('-' * 60 + '\n')

    try:
        # Create migrations tracking table
        create_migrations_table(cursor)

        # Execute migrations
        executed_count = 0
        skipped_count = 0
        error_count = 0

        for migration_file in migration_scripts:
            filename = migration_file.name

            # Check if migration already executed
            if is_migration_executed(cursor, filename):
                info(f"Skipping {filename} (already executed)")
                skipped_count += 1
                continue

            # Execute migration
            if execute_sql_file(cursor, migration_file):
                record_migration(cursor, filename)
                executed_count += 1
                success(f"Migration {filename} executed successfully")
            else:
                error_count += 1
                error(f"Migration {filename} failed")

        success(f'Migrations completed: {executed_count} executed, {skipped_count} skipped, {error_count} errors')

        if error_count > 0:
            warn(f'There were {error_count} errors during migration execution. Please review the errors above.')
            sys.exit(1)

    except Exception as e:
        error(f"Unexpected error: {e}")
        if conn:
            conn.rollback()
        sys.exit(1)
    
    # Verify tables were created
    log('\n' + '-' * 60)
    log('Verifying table creation', 'BRIGHT')
    log('-' * 60 + '\n')
    
    try:
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        """)
        public_tables = [row[0] for row in cursor.fetchall()]
        info(f"Found {len(public_tables)} tables in public schema")
        
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'ledger' 
            ORDER BY table_name
        """)
        ledger_tables = [row[0] for row in cursor.fetchall()]
        info(f"Found {len(ledger_tables)} tables in ledger schema")
        
        cursor.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'index_schema' 
            ORDER BY table_name
        """)
        index_tables = [row[0] for row in cursor.fetchall()]
        info(f"Found {len(index_tables)} tables in index_schema schema")
        
        # Check specific critical tables
        critical_tables = ['blocklist', 'teams', 'api_keys', 'users', 'plan_configs',
                          'requests', 'scrapes', 'subscriptions', 'customers', 'coupons']
        missing_tables = []
        for table in critical_tables:
            if table in public_tables:
                success(f"Table '{table}' exists")
            else:
                missing_tables.append(table)

        # Check index_schema tables
        index_critical_tables = ['index', 'engpicker_queue', 'engpicker_verdicts']
        for table in index_critical_tables:
            if table in index_tables:
                success(f"Index schema table '{table}' exists")
            else:
                warn(f"Index schema table '{table}' missing")
                error(f"Table '{table}' is missing")
        
        if missing_tables:
            log(f'\nMissing critical tables: {", ".join(missing_tables)}', 'RED')
            log('Please check the SQL execution errors above.\n')
            sys.exit(1)
        
        # Verify initial data in blocklist table
        log('\n' + '-' * 60)
        log('Verifying initial data', 'BRIGHT')
        log('-' * 60 + '\n')
        
        try:
            cursor.execute("SELECT COUNT(*) FROM public.blocklist")
            blocklist_count = cursor.fetchone()[0]
            if blocklist_count > 0:
                success(f"Blocklist table has {blocklist_count} row(s)")
            else:
                warn("Blocklist table is empty (expected at least 1 row)")
            
            # Verify plan configs
            cursor.execute("SELECT COUNT(*) FROM public.plan_configs")
            plan_count = cursor.fetchone()[0]
            if plan_count >= 4:
                success(f"Plan configs table has {plan_count} plan(s)")
            else:
                warn(f"Plan configs table has only {plan_count} plan(s) (expected at least 4)")
        except psycopg2.Error as e:
            warn(f"Could not verify initial data: {e}")
        
        # Verify indexes
        log('\n' + '-' * 60)
        log('Verifying indexes', 'BRIGHT')
        log('-' * 60 + '\n')
        
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM pg_indexes 
                WHERE schemaname = 'public'
            """)
            index_count = cursor.fetchone()[0]
            success(f"Found {index_count} indexes in public schema")
            
            # Check for critical indexes
            critical_indexes = ['idx_api_keys_team_id', 'idx_teams_plan_id', 'idx_requests_team_id']
            for index_name in critical_indexes:
                cursor.execute("""
                    SELECT 1 FROM pg_indexes 
                    WHERE schemaname = 'public' AND indexname = %s
                """, (index_name,))
                if cursor.fetchone():
                    success(f"Index '{index_name}' exists")
                else:
                    warn(f"Index '{index_name}' not found")
        except psycopg2.Error as e:
            warn(f"Could not verify indexes: {e}")
        
        # Verify triggers
        log('\n' + '-' * 60)
        log('Verifying triggers', 'BRIGHT')
        log('-' * 60 + '\n')
        
        try:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.triggers 
                WHERE trigger_schema = 'public'
            """)
            trigger_count = cursor.fetchone()[0]
            success(f"Found {trigger_count} triggers in public schema")
        except psycopg2.Error as e:
            warn(f"Could not verify triggers: {e}")
        
    except psycopg2.Error as e:
        error(f"Verification error: {e}")
        sys.exit(1)
    
    # Close connection
    if cursor:
        cursor.close()
    if conn:
        conn.close()
    
    # Summary
    log('\n' + '=' * 60)
    log('Summary', 'BRIGHT')
    log('=' * 60 + '\n')

    success('Supabase database initialization completed successfully!')
    log(f'  - {len(public_tables)} tables in public schema')
    log(f'  - {len(ledger_tables)} tables in ledger schema')
    log(f'  - {len(index_tables)} tables in index_schema schema')
    log(f'  - {executed_count} migrations executed')
    print()

    log('Next Steps:', 'BRIGHT')
    print()
    log('1. Restart your Firecrawl services:')
    log('   docker compose down')
    log('   docker compose up -d')
    print()
    log('2. Check the API logs to ensure Supabase connection works:')
    log('   docker compose logs api -f')
    print()
    log('3. Test the Dashboard API endpoints')
    print()

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log('\n\nInitialization cancelled by user.', 'YELLOW')
        sys.exit(1)
    except Exception as e:
        error(f'Fatal error: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
