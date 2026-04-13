-- Migration: Force add missing columns (bypassing migration check)
-- This script adds columns that should have been added by 04 but were skipped

-- ============================================
-- Add missing columns to public.requests table
-- ============================================
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS api_version text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS target_hint text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS integration text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS zeroDataRetention boolean DEFAULT false;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS dr_clean_by timestamptz;

-- ============================================
-- Add missing columns to public.scrapes table
-- ============================================
ALTER TABLE public.scrapes ADD COLUMN IF NOT EXISTS pdf_num_pages integer;

-- ============================================
-- Create searches table for search logging
-- ============================================
CREATE TABLE IF NOT EXISTS public.searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.requests(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  query text NOT NULL,
  options jsonb,
  credits_cost bigint DEFAULT 0,
  is_successful boolean DEFAULT false,
  error text,
  num_results integer DEFAULT 0,
  time_taken numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for searches table
CREATE INDEX IF NOT EXISTS idx_searches_request_id ON public.searches(request_id);
CREATE INDEX IF NOT EXISTS idx_searches_team_id ON public.searches(team_id);
CREATE INDEX IF NOT EXISTS idx_searches_created_at ON public.searches(created_at);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_searches_updated_at ON public.searches;
CREATE TRIGGER update_searches_updated_at BEFORE UPDATE ON public.searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Add missing columns to public.agent_sponsors table
-- ============================================
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS verification_deadline timestamptz;
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS sandboxed_team_id uuid;
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS verification_token text;
ALTER TABLE public.agent_sponsors ADD COLUMN IF NOT EXISTS api_key_id uuid;

-- ============================================
-- Add missing columns to index_schema.index table
-- ============================================
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS original_url text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS resolved_url text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS has_screenshot boolean DEFAULT false;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS has_screenshot_fullscreen boolean DEFAULT false;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS is_mobile boolean DEFAULT false;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS location_country text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS location_languages text[];
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS status integer;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS is_precrawl boolean DEFAULT false;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS is_stealth boolean DEFAULT false;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS wait_time_ms integer;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS description text;

-- Add URL split hash columns
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_0_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_1_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_2_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_3_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_4_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_5_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_6_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_7_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_8_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS url_split_9_hash text;

-- Add domain split hash columns
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS domain_splits_0_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS domain_splits_1_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS domain_splits_2_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS domain_splits_3_hash text;
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS domain_splits_4_hash text;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_index_url_hash ON index_schema.index(url_hash);
CREATE INDEX IF NOT EXISTS idx_index_status ON index_schema.index(status);
CREATE INDEX IF NOT EXISTS idx_index_is_mobile ON index_schema.index(is_mobile);
CREATE INDEX IF NOT EXISTS idx_index_is_stealth ON index_schema.index(is_stealth);

-- ============================================
-- Create jobs table for OMCE (One More Crawl Engine) job queue
-- ============================================
CREATE TABLE IF NOT EXISTS index_schema.jobs (
  id bigserial PRIMARY KEY,
  domain_hash text NOT NULL,
  domain_level integer NOT NULL,
  job_type text NOT NULL DEFAULT 'omce',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for jobs table
CREATE INDEX IF NOT EXISTS idx_jobs_domain_hash ON index_schema.jobs(domain_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON index_schema.jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON index_schema.jobs(created_at);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_jobs_updated_at ON index_schema.jobs;
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON index_schema.jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Create index_get_recent_4 function
-- This function retrieves recent index entries based on URL hash and various filters
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.index_get_recent_4(
  p_url_hash text,
  p_max_age_ms bigint,
  p_is_mobile boolean,
  p_block_ads boolean,
  p_feature_screenshot boolean,
  p_feature_screenshot_fullscreen boolean,
  p_location_country text,
  p_location_languages text[],
  p_wait_time_ms integer,
  p_is_stealth boolean,
  p_min_age_ms bigint
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  status integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    i.id,
    i.created_at,
    i.status
  FROM index_schema.index i
  WHERE i.url_hash = p_url_hash
    AND i.created_at >= NOW() - (p_max_age_ms * INTERVAL '1 millisecond')
    AND (p_is_mobile IS NULL OR i.is_mobile = p_is_mobile)
    AND (p_block_ads IS NULL OR i.block_ads = p_block_ads)
    AND (p_feature_screenshot IS NULL OR i.has_screenshot = p_feature_screenshot)
    AND (p_feature_screenshot_fullscreen IS NULL OR i.has_screenshot_fullscreen = p_feature_screenshot_fullscreen)
    AND (p_location_country IS NULL OR i.location_country = p_location_country)
    AND (p_location_languages IS NULL OR i.location_languages = p_location_languages)
    AND (p_wait_time_ms IS NULL OR i.wait_time_ms = p_wait_time_ms)
    AND (p_is_stealth IS NULL OR i.is_stealth = p_is_stealth)
    AND (p_min_age_ms IS NULL OR i.created_at <= NOW() - (p_min_age_ms * INTERVAL '1 millisecond'))
  ORDER BY i.created_at DESC
  LIMIT 4;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_max_age function
-- This function retrieves the maximum age for cached content based on domain hash
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_max_age(
  i_domain_hash text
)
RETURNS TABLE (
  max_age bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at)) * 1000)::bigint, 2 * 24 * 60 * 60 * 1000) as max_age
  FROM index_schema.index
  WHERE url_hash = i_domain_hash;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_index_at_split_level function
-- This function queries index at URL split level
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_index_at_split_level(
  i_level integer,
  i_url_hash text,
  i_newer_than timestamptz
)
RETURNS TABLE (
  resolved_url text
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.resolved_url
  FROM index_schema.index i
  WHERE i.url_split_0_hash = i_url_hash
    AND i.created_at >= i_newer_than
  LIMIT 1000;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_index_at_domain_split_level function
-- This function queries index at domain split level
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_index_at_domain_split_level(
  i_level integer,
  i_domain_hash text,
  i_newer_than timestamptz
)
RETURNS TABLE (
  resolved_url text
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT i.resolved_url
  FROM index_schema.index i
  WHERE i.domain_splits_0_hash = i_domain_hash
    AND i.created_at >= i_newer_than
  LIMIT 1000;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_omce_signatures function
-- This function queries OMCE signatures
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_omce_signatures(
  i_domain_hash text,
  i_newer_than timestamptz
)
RETURNS TABLE (
  signatures text[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT ARRAY_AGG(DISTINCT i.url_hash) as signatures
  FROM index_schema.index i
  WHERE i.domain_splits_0_hash = i_domain_hash
    AND i.created_at >= i_newer_than;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_engpicker_verdict function
-- This function queries engine picker verdict
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_engpicker_verdict(
  i_domain_hash text
)
RETURNS TABLE (
  verdict text
) AS $$
BEGIN
  RETURN QUERY
  SELECT v.verdict
  FROM index_schema.engpicker_verdicts v
  WHERE v.domain_hash = i_domain_hash
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_index_at_split_level_with_meta function
-- This function queries index at URL split level with metadata
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_index_at_split_level_with_meta(
  i_level integer,
  i_url_hash text,
  i_newer_than timestamptz
)
RETURNS TABLE (
  resolved_url text,
  title text,
  description text
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    i.resolved_url,
    i.title,
    i.description
  FROM index_schema.index i
  WHERE i.url_split_0_hash = i_url_hash
    AND i.created_at >= i_newer_than
  LIMIT 1000;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_index_at_domain_split_level_with_meta function
-- This function queries index at domain split level with metadata
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_index_at_domain_split_level_with_meta(
  i_level integer,
  i_domain_hash text,
  i_newer_than timestamptz
)
RETURNS TABLE (
  resolved_url text,
  title text,
  description text
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    i.resolved_url,
    i.title,
    i.description
  FROM index_schema.index i
  WHERE i.domain_splits_0_hash = i_domain_hash
    AND i.created_at >= i_newer_than
  LIMIT 1000;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Create query_domain_priority function
-- This function queries domain priority for precrawl
-- ============================================
CREATE OR REPLACE FUNCTION index_schema.query_domain_priority(
  p_min_total bigint,
  p_min_priority numeric,
  p_lim integer,
  p_time timestamptz
)
RETURNS TABLE (
  domain_hash text,
  priority numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    i.domain_splits_0_hash as domain_hash,
    COUNT(*)::numeric / NULLIF(COUNT(*) FILTER (WHERE i.created_at >= p_time - INTERVAL '7 days'), 0) as priority
  FROM index_schema.index i
  WHERE i.created_at >= p_time - INTERVAL '30 days'
  GROUP BY i.domain_splits_0_hash
  HAVING COUNT(*) >= p_min_total
    AND (COUNT(*)::numeric / NULLIF(COUNT(*) FILTER (WHERE i.created_at >= p_time - INTERVAL '7 days'), 0)) >= p_min_priority
  ORDER BY priority DESC
  LIMIT p_lim;
END;
$$ LANGUAGE plpgsql;
