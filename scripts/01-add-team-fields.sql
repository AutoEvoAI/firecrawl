-- Migration: Add missing fields to teams table
-- This adds created_by and org_id fields that were missing from the initial schema

-- Add created_by field to teams table
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS created_by uuid;

-- Add org_id field to teams table
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Add index for created_by
CREATE INDEX IF NOT EXISTS idx_teams_created_by ON public.teams(created_by);

-- Add index for org_id
CREATE INDEX IF NOT EXISTS idx_teams_org_id ON public.teams(org_id);

-- Add foreign key for created_by referencing users table
ALTER TABLE public.teams ADD CONSTRAINT fk_teams_created_by 
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
