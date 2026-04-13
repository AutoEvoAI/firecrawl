# Supabase Database Setup Guide

This guide explains how to initialize your Supabase database with all required tables for Firecrawl.

## Schema Configuration

Firecrawl supports using separate Supabase schemas for different purposes:

- **firecrawl_main**: Main schema for core functionality (authentication, teams, API keys, etc.)
- **firecrawl_index**: Index schema for search indexing features (optional)

**Important**: The Supabase JS client does not support specifying schemas via URL parameters (e.g., `?schema=firecrawl_main`). Instead, schemas should be configured through:

1. **Supabase Dashboard**: Set the default schema for your project
2. **SQL commands**: Use `SET search_path TO schema_name` in your queries
3. **Client configuration**: Pass the schema option when creating the Supabase client

For most use cases, you can use the default `public` schema. If you need to use custom schemas, configure them in your Supabase project settings.

## Quick Start

### Option 1: Using Supabase Dashboard (Recommended - No Password Required)

1. Open your Supabase project dashboard: https://app.supabase.com
2. Navigate to the **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy the contents of `supabase-init.sql`
5. Paste it into the SQL Editor
6. Click **Run** to execute the script

This is the simplest method - no database password or CLI required.

### Option 2: Using Supabase CLI

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Execute the SQL file
supabase db execute --file supabase-init.sql --project-ref YOUR_PROJECT_REF
```

### Option 3: Using psql

```bash
# Extract connection details from your Supabase URL
# Format: postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

psql "postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres" -f supabase-init.sql
```

### Option 4: Using Python Script (Recommended for Automation)

```bash
# Add to your .env file:
# SUPABASE_POSTGRES_HOST=aws-1-ap-northeast-1.pooler.supabase.com
# SUPABASE_POSTGRES_USER=postgres.your_project_ref
# SUPABASE_POSTGRES_PASSWORD=your_database_password

# Install dependencies (if not already installed)
pip install psycopg2-binary python-dotenv

# Run the initialization script
python scripts/init-supabase.py
```

**Note:** You can find the PostgreSQL host, username, and password in Supabase Dashboard > Database > Connection string.

## What Gets Created

The SQL script creates the following:

### Public Schema Tables
- `blocklist` - URL filtering and allowed keywords
- `teams` - Team management
- `api_keys` - API key management
- `users` - User accounts
- `user_teams` - User-team relationships
- `user_referring_integration` - Referral tracking
- `agent_sponsors` - Agent sponsorship
- `user_notifications` - User notifications
- `coupons` - Discount coupons
- `customers` - Stripe customer integration
- `auto_recharge_transactions` - Auto-recharge history
- `webhook_logs` - Webhook delivery logs
- `concurrency_log` - Concurrent request tracking
- `llm_texts` - LLM-generated text storage
- `idempotency_keys` - Request idempotency
- `subscriptions` - Subscription management
- `credit_usage` - Credit usage tracking
- `plan_configs` - Plan configuration
- `team_overrides` - Team-specific overrides
- `organization_overrides` - Organization-specific overrides
- `organizations` - Organization management
- `organization_teams` - Organization-team relationships
- `requests` - Request tracking
- `scrapes` - Scrape results

### Ledger Schema Tables
- `provider_definitions` - Event provider definitions
- `tracks` - Event tracking

### Index Schema Tables
- `index` - Search index

### Additional Features
- Row Level Security (RLS) policies
- Performance indexes
- Automatic `updated_at` triggers
- Initial data (default plans, blocklist, etc.)

## Verification

After running the script, verify the tables were created:

1. Go to Supabase Dashboard → **Table Editor**
2. You should see all the tables listed above
3. Check that the `blocklist` table has one row with default data
4. Check that the `plan_configs` table has default plans (free, starter, standard, scale)

## Troubleshooting

### Permission Denied
If you get permission errors, ensure you're using the `postgres` user or a user with sufficient privileges.

### Table Already Exists
The script uses `IF NOT EXISTS` clauses, so it's safe to run multiple times. Existing tables won't be recreated.

### Connection Issues
- Verify your `SUPABASE_URL` and `SUPABASE_SERVICE_TOKEN` in `.env`
- Ensure your Supabase project is active
- Check network connectivity

## Environment Variables

Make sure these are set in your `.env` file:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_REPLICA_URL=https://your-project.supabase.co
SUPABASE_ANON_TOKEN=your-anon-token
SUPABASE_SERVICE_TOKEN=your-service-token
USE_DB_AUTHENTICATION=true
```

## Next Steps

After database initialization:

1. Restart your Firecrawl services:
   ```bash
   docker compose down
   docker compose up -d
   ```

2. Check the API logs to ensure Supabase connection works:
   ```bash
   docker compose logs api -f
   ```

3. Test the Dashboard API endpoints

4. Test Proxy and OpenSandbox functionality

## Security Notes

The SQL script includes permissive RLS policies for development. For production:

1. Review and restrict RLS policies
2. Implement proper user authentication
3. Use environment-specific configurations
4. Regularly audit access permissions

## Support

If you encounter issues:

1. Check Supabase logs in the Dashboard
2. Verify environment variables are correctly set
3. Ensure your Supabase project has sufficient resources
4. Review the SQL script for any custom modifications needed
