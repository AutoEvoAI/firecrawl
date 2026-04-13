-- Firecrawl Supabase Database Initialization Script
-- This script creates all required tables for Firecrawl to work with Supabase

-- ============================================
-- Extensions
-- ============================================

-- Enable pgvector extension for vector operations
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- Public Schema Tables
-- ============================================

-- Blocklist table for URL filtering
CREATE TABLE IF NOT EXISTS public.blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{"blocklist": [], "allowedKeywords": []}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Teams table
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan_id text,
  credits bigint DEFAULT 0,
  is_admin boolean DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- API Keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  key_value text UNIQUE NOT NULL,
  name text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_used_at timestamptz
);

-- Users table
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  email text UNIQUE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User-Teams junction table
CREATE TABLE IF NOT EXISTS public.user_teams (
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);

-- User Referring Integration table
CREATE TABLE IF NOT EXISTS public.user_referring_integration (
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  referring_integration_id uuid,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- Agent Sponsors table
CREATE TABLE IF NOT EXISTS public.agent_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User Notifications table
CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Coupons table
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  discount_amount bigint,
  discount_percentage numeric,
  max_uses integer,
  used_count integer DEFAULT 0,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Customers table (for Stripe integration)
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Auto Recharge Transactions table
CREATE TABLE IF NOT EXISTS public.auto_recharge_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  status text DEFAULT 'pending',
  stripe_payment_intent_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Webhook Logs table
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  url text NOT NULL,
  payload jsonb,
  response_status integer,
  response_body text,
  created_at timestamptz DEFAULT now()
);

-- Concurrency Log table
CREATE TABLE IF NOT EXISTS public.concurrency_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  concurrent_requests integer NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- LLM Texts table
CREATE TABLE IF NOT EXISTS public.llm_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  embedding vector(1536),
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Idempotency Keys table
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_value text UNIQUE NOT NULL,
  request_params jsonb,
  response_data jsonb,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE,
  stripe_price_id text,
  status text DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Credit Usage table
CREATE TABLE IF NOT EXISTS public.credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  amount bigint NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Plan Configs table
CREATE TABLE IF NOT EXISTS public.plan_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  max_credits bigint,
  max_concurrent_requests integer,
  max_team_members integer,
  features jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Team Overrides table
CREATE TABLE IF NOT EXISTS public.team_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid UNIQUE REFERENCES public.teams(id) ON DELETE CASCADE,
  max_credits bigint,
  max_concurrent_requests integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Organization Overrides table
CREATE TABLE IF NOT EXISTS public.organization_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid UNIQUE NOT NULL,
  max_credits bigint,
  max_concurrent_requests integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Organization Teams table
CREATE TABLE IF NOT EXISTS public.organization_teams (
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (organization_id, team_id)
);

-- Requests table
CREATE TABLE IF NOT EXISTS public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  mode text NOT NULL,
  url text,
  options jsonb,
  status text DEFAULT 'processing',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Scrapes table
CREATE TABLE IF NOT EXISTS public.scrapes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.requests(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  url text NOT NULL,
  status text DEFAULT 'processing',
  data jsonb,
  metadata jsonb,
  cost_tracking jsonb,
  credits_cost bigint DEFAULT 0,
  error text,
  is_successful boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================
-- Ledger Schema Tables
-- ============================================

CREATE SCHEMA IF NOT EXISTS ledger;

-- Provider Definitions table
CREATE TABLE IF NOT EXISTS ledger.provider_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  event_schema jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tracks table (for event tracking)
CREATE TABLE IF NOT EXISTS ledger.tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid REFERENCES ledger.provider_definitions(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  event_slug text NOT NULL,
  data jsonb NOT NULL,
  occurred_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- Index Schema Tables
-- ============================================

CREATE SCHEMA IF NOT EXISTS index_schema;

-- Index table for search indexing
CREATE TABLE IF NOT EXISTS index_schema.index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  title text,
  content text,
  metadata jsonb,
  embedding vector(1536),
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Engpicker queue table for engine selection jobs
CREATE TABLE IF NOT EXISTS index_schema.engpicker_queue (
  id bigserial PRIMARY KEY,
  domain_hash text NOT NULL,
  domain_level integer NOT NULL,
  picked_up_at timestamptz,
  done boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Engpicker verdicts table for storing engine selection results
CREATE TABLE IF NOT EXISTS index_schema.engpicker_verdicts (
  id bigserial PRIMARY KEY,
  domain_hash text NOT NULL UNIQUE,
  verdict text NOT NULL, -- "TlsClientOk", "ChromeCdpRequired", "Uncertain", or "Unknown"
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================
-- Indexes for Performance
-- ============================================

-- Blocklist indexes
CREATE INDEX IF NOT EXISTS idx_blocklist_created_at ON public.blocklist(created_at);

-- Teams indexes
CREATE INDEX IF NOT EXISTS idx_teams_plan_id ON public.teams(plan_id);
CREATE INDEX IF NOT EXISTS idx_teams_is_admin ON public.teams(is_admin);
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON public.teams(created_by);
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON public.teams(org_id);

-- API Keys indexes
CREATE INDEX IF NOT EXISTS idx_api_keys_team_id ON public.api_keys(team_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON public.api_keys(is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_value ON public.api_keys(key_value);

-- User-Teams indexes
CREATE INDEX IF NOT EXISTS idx_user_teams_user_id ON public.user_teams(user_id);
CREATE INDEX IF NOT EXISTS idx_user_teams_team_id ON public.user_teams(team_id);

-- Requests indexes
CREATE INDEX IF NOT EXISTS idx_requests_team_id ON public.requests(team_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON public.requests(created_at);

-- Scrapes indexes
CREATE INDEX IF NOT EXISTS idx_scrapes_request_id ON public.scrapes(request_id);
CREATE INDEX IF NOT EXISTS idx_scrapes_team_id ON public.scrapes(team_id);
CREATE INDEX IF NOT EXISTS idx_scrapes_status ON public.scrapes(status);
CREATE INDEX IF NOT EXISTS idx_scrapes_url ON public.scrapes(url);

-- Ledger Tracks indexes
CREATE INDEX IF NOT EXISTS idx_ledger_tracks_team_id ON ledger.tracks(team_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tracks_user_id ON ledger.tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tracks_event_slug ON ledger.tracks(event_slug);
CREATE INDEX IF NOT EXISTS idx_ledger_tracks_occurred_at ON ledger.tracks(occurred_at);

-- Index Schema indexes
CREATE INDEX IF NOT EXISTS idx_index_url ON index_schema.index(url);
CREATE INDEX IF NOT EXISTS idx_index_team_id ON index_schema.index(team_id);
CREATE INDEX IF NOT EXISTS idx_index_created_at ON index_schema.index(created_at);

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_referring_integration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_recharge_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.concurrency_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_texts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrapes ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (adjust according to your security requirements)
-- These are permissive policies for development - adjust for production

CREATE POLICY "Allow all access for development" ON public.blocklist
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.teams
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.api_keys
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.users
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.user_teams
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.user_referring_integration
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.agent_sponsors
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.user_notifications
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.coupons
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.customers
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.auto_recharge_transactions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.webhook_logs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.concurrency_log
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.llm_texts
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.idempotency_keys
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.subscriptions
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.credit_usage
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.plan_configs
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.team_overrides
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.organization_overrides
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.organizations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.organization_teams
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.requests
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access for development" ON public.scrapes
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Initial Data
-- ============================================

-- Insert default blocklist data (delete any existing rows first to ensure only one row)
DELETE FROM public.blocklist WHERE true;
INSERT INTO public.blocklist (data)
VALUES ('{"blocklist": [], "allowedKeywords": []}'::jsonb);

-- Insert default plan configs
INSERT INTO public.plan_configs (name, max_credits, max_concurrent_requests, max_team_members, features) 
VALUES 
  ('free', 1000, 10, 5, '{"stealth_proxy": false, "open_sandbox": false}'::jsonb),
  ('hobby', 10000, 50, 10, '{"stealth_proxy": true, "open_sandbox": true}'::jsonb),
  ('standard', 100000, 100, 25, '{"stealth_proxy": true, "open_sandbox": true, "priority_support": true}'::jsonb),
  ('growth', 500000, 250, 50, '{"stealth_proxy": true, "open_sandbox": true, "priority_support": true}'::jsonb),
  ('scale', 1000000, 500, 100, '{"stealth_proxy": true, "open_sandbox": true, "priority_support": true, "dedicated_support": true}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Insert default provider definition for ledger
INSERT INTO ledger.provider_definitions (slug, name, description, event_schema)
VALUES (
  'firecrawl',
  'Firecrawl Provider',
  'Firecrawl event tracking provider',
  '{"concurrent-browser-limit-reached": {"team_id": "string"}}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- Functions for Updated At
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to tables with updated_at
CREATE TRIGGER update_blocklist_updated_at BEFORE UPDATE ON public.blocklist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_auto_recharge_transactions_updated_at BEFORE UPDATE ON public.auto_recharge_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plan_configs_updated_at BEFORE UPDATE ON public.plan_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_team_overrides_updated_at BEFORE UPDATE ON public.team_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organization_overrides_updated_at BEFORE UPDATE ON public.organization_overrides
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requests_updated_at BEFORE UPDATE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scrapes_updated_at BEFORE UPDATE ON public.scrapes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Functions for Authentication and Credit Usage
-- ============================================

-- Function to get auth credit usage chunk by API key
CREATE OR REPLACE FUNCTION auth_credit_usage_chunk_47(
  input_key text,
  i_is_extract boolean,
  tally_untallied_credits boolean
)
RETURNS TABLE (
  api_key text,
  api_key_id uuid,
  team_id uuid,
  org_id text,
  sub_id text,
  sub_current_period_start timestamptz,
  sub_current_period_end timestamptz,
  sub_user_id text,
  price_id text,
  price_credits bigint,
  price_should_be_graceful boolean,
  price_associated_auto_recharge_price_id text,
  credits_used bigint,
  coupon_credits bigint,
  adjusted_credits_used bigint,
  remaining_credits bigint,
  total_credits_sum bigint,
  plan_priority jsonb,
  rate_limits jsonb,
  concurrency bigint,
  flags jsonb,
  is_extract boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ak.key_value as api_key,
    ak.id as api_key_id,
    t.id as team_id,
    null as org_id,
    s.id::text as sub_id,
    s.current_period_start as sub_current_period_start,
    s.current_period_end as sub_current_period_end,
    null as sub_user_id,
    pc.id::text as price_id,
    pc.max_credits::bigint as price_credits,
    false as price_should_be_graceful,
    null as price_associated_auto_recharge_price_id,
    COALESCE(t.credits, 0)::bigint as credits_used,
    0::bigint as coupon_credits,
    COALESCE(t.credits, 0)::bigint as adjusted_credits_used,
    pc.max_credits::bigint - COALESCE(t.credits, 0)::bigint as remaining_credits,
    pc.max_credits::bigint as total_credits_sum,
    '{"bucketLimit": 25, "planModifier": 0.1}'::jsonb as plan_priority,
    '{"crawl": 2, "scrape": 2, "search": 2, "map": 2, "extract": 200, "preview": 2, "crawlStatus": 2, "extractStatus": 2}'::jsonb as rate_limits,
    CASE WHEN i_is_extract THEN 200 ELSE 2 END::bigint as concurrency,
    null::jsonb as flags,
    i_is_extract as is_extract
  FROM public.api_keys ak
  JOIN public.teams t ON t.id = ak.team_id
  JOIN public.plan_configs pc ON pc.id = t.plan_id::uuid
  LEFT JOIN public.subscriptions s ON s.team_id = t.id
  WHERE (ak.key_value = input_key OR ak.key_value = 'fc-' || input_key) AND ak.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- Function to get auth credit usage chunk by team_id
CREATE OR REPLACE FUNCTION auth_credit_usage_chunk_47_from_team(
  input_team text,
  i_is_extract boolean,
  tally_untallied_credits boolean
)
RETURNS TABLE (
  api_key_id uuid,
  team_id uuid,
  org_id text,
  sub_id text,
  sub_current_period_start timestamptz,
  sub_current_period_end timestamptz,
  sub_user_id text,
  price_id text,
  price_credits bigint,
  price_should_be_graceful boolean,
  price_associated_auto_recharge_price_id text,
  credits_used bigint,
  coupon_credits bigint,
  adjusted_credits_used bigint,
  remaining_credits bigint,
  total_credits_sum bigint,
  plan_priority jsonb,
  rate_limits jsonb,
  concurrency bigint,
  flags jsonb,
  is_extract boolean
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    null::uuid as api_key_id,
    t.id as team_id,
    t.org_id::text as org_id,
    s.id::text as sub_id,
    s.current_period_start as sub_current_period_start,
    s.current_period_end as sub_current_period_end,
    null as sub_user_id,
    pc.id::text as price_id,
    pc.max_credits::bigint as price_credits,
    false as price_should_be_graceful,
    null as price_associated_auto_recharge_price_id,
    COALESCE(t.credits, 0)::bigint as credits_used,
    0::bigint as coupon_credits,
    COALESCE(t.credits, 0)::bigint as adjusted_credits_used,
    pc.max_credits::bigint - COALESCE(t.credits, 0)::bigint as remaining_credits,
    pc.max_credits::bigint as total_credits_sum,
    '{"bucketLimit": 25, "planModifier": 0.1}'::jsonb as plan_priority,
    '{"crawl": 2, "scrape": 2, "search": 2, "map": 2, "extract": 200, "preview": 2, "crawlStatus": 2, "extractStatus": 2}'::jsonb as rate_limits,
    COALESCE(org_override.max_concurrent_requests, pc.max_concurrent_requests, CASE WHEN i_is_extract THEN 200 ELSE 2 END)::bigint as concurrency,
    null::jsonb as flags,
    i_is_extract as is_extract
  FROM public.teams t
  JOIN public.plan_configs pc ON pc.id = t.plan_id::uuid
  LEFT JOIN public.subscriptions s ON s.team_id = t.id
  LEFT JOIN public.organization_overrides org_override ON org_override.organization_id = t.org_id
  WHERE t.id = input_team::uuid;
END;
$$ LANGUAGE plpgsql;

-- Function to bill team for credit usage
CREATE OR REPLACE FUNCTION bill_team_6(
  _team_id uuid,
  sub_id uuid,
  fetch_subscription boolean,
  p_credits bigint,
  i_api_key_id uuid,
  is_extract_param boolean
)
RETURNS jsonb AS $$
DECLARE
  v_subscription_id uuid;
  v_current_credits bigint;
BEGIN
  -- Insert credit usage record
  INSERT INTO public.credit_usage (
    team_id,
    amount,
    description,
    created_at
  ) VALUES (
    _team_id,
    p_credits,
    'Credit usage from API',
    now()
  );

  -- Fetch subscription if requested
  IF fetch_subscription THEN
    SELECT id INTO v_subscription_id
    FROM public.subscriptions
    WHERE team_id = _team_id
      AND status IN ('active', 'trialing')
      AND is_extract = is_extract_param
    ORDER BY created_at DESC
    LIMIT 1;

    sub_id := v_subscription_id;
  END IF;

  -- Update team credits
  SELECT credits INTO v_current_credits FROM public.teams WHERE id = _team_id;
  UPDATE public.teams
  SET credits = v_current_credits - COALESCE(p_credits, 0)
  WHERE id = _team_id;

  RETURN jsonb_build_object(
    'success', true,
    'team_id', _team_id,
    'credits', p_credits,
    'sub_id', sub_id
  );
END;
$$ LANGUAGE plpgsql;
