-- Migration: Add missing OMCE job function
-- This adds the insert_omce_job_if_needed function to the index_schema

CREATE OR REPLACE FUNCTION index_schema.insert_omce_job_if_needed(
    i_domain_hash text,
    i_domain_level integer
) RETURNS void AS $$
BEGIN
    -- Check if OMCE job already exists for this domain
    IF NOT EXISTS (
        SELECT 1 FROM index_schema.jobs 
        WHERE domain_hash = i_domain_hash 
        AND job_type = 'omce'
    ) THEN
        -- Insert OMCE job if it doesn't exist
        INSERT INTO index_schema.jobs (
            domain_hash,
            domain_level,
            job_type,
            status,
            created_at,
            updated_at
        ) VALUES (
            i_domain_hash,
            i_domain_level,
            'omce',
            'pending',
            NOW(),
            NOW()
        );
    END IF;
END;
$$ LANGUAGE plpgsql;
