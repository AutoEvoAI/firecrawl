-- Migration: Add missing fields to requests, scraps, and index tables
-- This adds api_key_id, options, and block_ads fields that were missing from the initial schema

-- Add api_key_id field to requests table
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS api_key_id integer;

-- Add index for api_key_id in requests table
CREATE INDEX IF NOT EXISTS idx_requests_api_key_id ON public.requests(api_key_id);

-- Add options field to scraps table
ALTER TABLE public.scrapes ADD COLUMN IF NOT EXISTS options jsonb;

-- Add block_ads field to index table
ALTER TABLE index_schema.index ADD COLUMN IF NOT EXISTS block_ads boolean DEFAULT false;

-- Add index for block_ads in index table
CREATE INDEX IF NOT EXISTS idx_index_block_ads ON index_schema.index(block_ads);
