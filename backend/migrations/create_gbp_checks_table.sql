-- ============================================================================
-- GBP_CHECKS TABLE
-- Stores Google Business Profile ranking check results from DataForSEO
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gbp_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Search criteria
  keyword TEXT NOT NULL,
  business_name TEXT NOT NULL,
  location TEXT NOT NULL,
  
  -- Status and tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  task_id TEXT UNIQUE,
  
  -- Cost tracking
  cost NUMERIC(10, 6) DEFAULT 0,
  
  -- Full DataForSEO API response stored as JSONB
  -- Structure: { businesses: [...], totalResults: number, searchMetadata: {...} }
  results JSONB,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- INDEXES FOR QUERY PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_gbp_checks_status 
  ON public.gbp_checks(status);

CREATE INDEX IF NOT EXISTS idx_gbp_checks_task_id 
  ON public.gbp_checks(task_id);

CREATE INDEX IF NOT EXISTS idx_gbp_checks_created_at 
  ON public.gbp_checks(created_at);

CREATE INDEX IF NOT EXISTS idx_gbp_checks_keyword 
  ON public.gbp_checks(keyword);

-- JSONB index for efficient queries on results column
CREATE INDEX IF NOT EXISTS idx_gbp_checks_results_gin 
  ON public.gbp_checks USING GIN(results);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.gbp_checks ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can select all gbp_checks
CREATE POLICY IF NOT EXISTS "Authenticated users can view gbp checks"
  ON public.gbp_checks
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users can insert gbp_checks
CREATE POLICY IF NOT EXISTS "Authenticated users can insert gbp checks"
  ON public.gbp_checks
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Policy: Authenticated users can update gbp_checks
CREATE POLICY IF NOT EXISTS "Authenticated users can update gbp checks"
  ON public.gbp_checks
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- Policy: Authenticated users can delete gbp_checks
CREATE POLICY IF NOT EXISTS "Authenticated users can delete gbp checks"
  ON public.gbp_checks
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- ROLE PERMISSIONS
-- ============================================================================

GRANT SELECT ON public.gbp_checks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gbp_checks TO authenticated;
GRANT ALL ON public.gbp_checks TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
