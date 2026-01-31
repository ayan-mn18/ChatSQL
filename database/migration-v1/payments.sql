-- ============================================
-- ChatSQL - Payments & Billing Migration (v1)
-- Dodo Payments Integration
-- ============================================
-- 
-- INSTRUCTIONS:
-- Run this migration after the initial schema (v0)
-- psql -U your_username -d chatsql -f database/migration-v1/payments.sql
-- ============================================

-- ============================================
-- UPDATE PLAN CONFIGURATIONS
-- New pricing tiers: Free, Pro ($10/mo), Lifetime ($100 one-time), Enterprise
-- ============================================

-- First, update existing plans and add new ones
-- Note: Removed TRUNCATE to preserve existing subscriptions
-- TRUNCATE TABLE plan_configurations CASCADE;

INSERT INTO plan_configurations (
    plan_type, 
    display_name, 
    description, 
    price_monthly, 
    price_yearly, 
    ai_tokens_limit, 
    queries_limit, 
    connections_limit, 
    storage_limit_mb, 
    features, 
    sort_order,
    is_active
) VALUES 
    -- Free Tier
    ('free', 'Free', 'Perfect for getting started with ChatSQL', 0, 0, 10000, 500, 2, 50, 
     '["Basic AI SQL generation", "2 database connections", "Query history (7 days)", "Community support", "Read-only after limits"]'::jsonb, 1, true),
    
    -- Pro Monthly ($10/mo)
    ('pro_monthly', 'Pro Monthly', 'For professionals who need more power - Monthly billing', 10.00, 10.00, 100000, 5000, 10, 500,
     '["Advanced AI features", "10 database connections", "Query history (90 days)", "Priority email support", "Custom saved queries", "Export to CSV/JSON", "No read-only restrictions"]'::jsonb, 2, true),
    
    -- Pro Yearly ($96/year = $8/mo)
    ('pro_yearly', 'Pro Yearly', 'For professionals who need more power - Yearly billing', 8.00, 96.00, 100000, 5000, 10, 500,
     '["Advanced AI features", "10 database connections", "Query history (90 days)", "Priority email support", "Custom saved queries", "Export to CSV/JSON", "No read-only restrictions", "2 months free compared to monthly"]'::jsonb, 3, true),
    
    -- Lifetime ($100 one-time payment)
    ('lifetime', 'Lifetime', 'One-time payment, lifetime access', 100.00, 100.00, -1, -1, 50, 5000,
     '["Unlimited AI tokens", "50 database connections", "Unlimited query history", "Priority support", "All Pro features", "Future updates included", "No recurring fees"]'::jsonb, 4, true),
    
    -- Enterprise (Contact Us)
    ('enterprise', 'Enterprise', 'For teams with advanced needs - Contact us for pricing', 0, 0, -1, -1, -1, -1,
     '["Unlimited everything", "Dedicated support", "24/7 support", "Team collaboration", "SSO/SAML", "Audit logs", "Custom integrations", "SLA guarantee", "On-premise option"]'::jsonb, 5, true)
ON CONFLICT (plan_type) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    price_monthly = EXCLUDED.price_monthly,
    price_yearly = EXCLUDED.price_yearly,
    ai_tokens_limit = EXCLUDED.ai_tokens_limit,
    queries_limit = EXCLUDED.queries_limit,
    connections_limit = EXCLUDED.connections_limit,
    storage_limit_mb = EXCLUDED.storage_limit_mb,
    features = EXCLUDED.features,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active,
    updated_at = CURRENT_TIMESTAMP;

-- ============================================
-- SUBSCRIPTIONS TABLE
-- Tracks active subscriptions with Dodo Payments
-- ============================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_type VARCHAR(50) NOT NULL REFERENCES plan_configurations(plan_type),
    
    -- Dodo Payments identifiers
    dodo_customer_id VARCHAR(255),
    dodo_subscription_id VARCHAR(255),
    dodo_product_id VARCHAR(255),
    
    -- Subscription details
    status VARCHAR(50) NOT NULL DEFAULT 'active',  -- 'active', 'cancelled', 'past_due', 'paused', 'expired'
    is_lifetime BOOLEAN DEFAULT FALSE,              -- True for one-time lifetime purchases
    
    -- Billing info
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    billing_interval VARCHAR(20),                   -- 'monthly', 'yearly', 'one_time'
    
    -- Dates
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique index to ensure only one active subscription per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_subscription 
    ON subscriptions(user_id) 
    WHERE status = 'active';

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_dodo_customer ON subscriptions(dodo_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_dodo_subscription ON subscriptions(dodo_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_type ON subscriptions(plan_type);

-- Trigger for subscriptions
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PAYMENTS TABLE
-- Transaction history for all payments
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    
    -- Dodo Payments identifiers
    dodo_payment_id VARCHAR(255) UNIQUE,
    dodo_customer_id VARCHAR(255),
    
    -- Payment details
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'succeeded', 'failed', 'refunded'
    payment_method VARCHAR(100),                     -- 'card', 'bank_transfer', etc.
    
    -- Description
    description TEXT,
    plan_type VARCHAR(50),
    
    -- Failure info
    failure_reason TEXT,
    failure_code VARCHAR(100),
    
    -- Refund info
    refunded_amount DECIMAL(10, 2) DEFAULT 0,
    refunded_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    receipt_url TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for payments
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_dodo_payment ON payments(dodo_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- Trigger for payments
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CONTACT REQUESTS TABLE
-- Enterprise inquiries and general contact form submissions
-- ============================================
CREATE TABLE IF NOT EXISTS contact_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Contact info
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    phone VARCHAR(50),
    
    -- Request details
    subject VARCHAR(255),
    message TEXT NOT NULL,
    request_type VARCHAR(50) NOT NULL DEFAULT 'general',  -- 'general', 'enterprise', 'support', 'feedback'
    plan_interest VARCHAR(50),                             -- Which plan they're interested in
    
    -- User reference (if logged in)
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'new',  -- 'new', 'in_progress', 'responded', 'closed'
    assigned_to VARCHAR(255),
    response_notes TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for contact_requests
CREATE INDEX IF NOT EXISTS idx_contact_requests_email ON contact_requests(email);
CREATE INDEX IF NOT EXISTS idx_contact_requests_user_id ON contact_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_requests_status ON contact_requests(status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_type ON contact_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests(created_at DESC);

-- Trigger for contact_requests
DROP TRIGGER IF EXISTS update_contact_requests_updated_at ON contact_requests;
CREATE TRIGGER update_contact_requests_updated_at
    BEFORE UPDATE ON contact_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- UPDATE USER_PLANS TABLE
-- Replace Stripe fields with Dodo fields
-- ============================================
ALTER TABLE user_plans 
    DROP COLUMN IF EXISTS stripe_customer_id,
    DROP COLUMN IF EXISTS stripe_subscription_id;

ALTER TABLE user_plans 
    ADD COLUMN IF NOT EXISTS dodo_customer_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS dodo_subscription_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS read_only_mode BOOLEAN DEFAULT FALSE;

-- Index for Dodo customer lookup
CREATE INDEX IF NOT EXISTS idx_user_plans_dodo_customer ON user_plans(dodo_customer_id);

-- ============================================
-- FUNCTION: Check if user is in read-only mode
-- Returns true if free tier limits are exhausted
-- ============================================
CREATE OR REPLACE FUNCTION check_user_read_only(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_plan_type VARCHAR(50);
    v_tokens_limit INTEGER;
    v_tokens_used INTEGER;
    v_queries_limit INTEGER;
    v_queries_used INTEGER;
    v_is_lifetime BOOLEAN;
BEGIN
    -- Get user's plan info
    SELECT plan_type, ai_tokens_limit, ai_tokens_used, queries_limit, queries_used, is_lifetime
    INTO v_plan_type, v_tokens_limit, v_tokens_used, v_queries_limit, v_queries_used, v_is_lifetime
    FROM user_plans
    WHERE user_id = p_user_id;
    
    -- If no plan found, treat as free tier with limits
    IF NOT FOUND THEN
        RETURN FALSE; -- New users get full access until plan is created
    END IF;
    
    -- Lifetime and paid users never go read-only
    IF v_is_lifetime OR v_plan_type IN ('pro', 'lifetime', 'enterprise') THEN
        RETURN FALSE;
    END IF;
    
    -- Free tier: check if limits are exhausted (-1 means unlimited)
    IF v_plan_type = 'free' THEN
        -- Check token limit
        IF v_tokens_limit != -1 AND v_tokens_used >= v_tokens_limit THEN
            RETURN TRUE;
        END IF;
        
        -- Check query limit
        IF v_queries_limit != -1 AND v_queries_used >= v_queries_limit THEN
            RETURN TRUE;
        END IF;
    END IF;
    
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Get user's subscription status
-- ============================================
CREATE OR REPLACE FUNCTION get_user_subscription_status(p_user_id UUID)
RETURNS TABLE (
    has_active_subscription BOOLEAN,
    plan_type VARCHAR(50),
    is_lifetime BOOLEAN,
    subscription_status VARCHAR(50),
    current_period_end TIMESTAMP WITH TIME ZONE,
    is_read_only BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE WHEN s.id IS NOT NULL AND s.status = 'active' THEN TRUE ELSE FALSE END as has_active_subscription,
        COALESCE(s.plan_type, up.plan_type, 'free'::VARCHAR(50)) as plan_type,
        COALESCE(s.is_lifetime, up.is_lifetime, FALSE) as is_lifetime,
        COALESCE(s.status, 'none'::VARCHAR(50)) as subscription_status,
        s.current_period_end,
        check_user_read_only(p_user_id) as is_read_only
    FROM user_plans up
    LEFT JOIN subscriptions s ON s.user_id = p_user_id AND s.status = 'active'
    WHERE up.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Upgrade user plan after payment
-- ============================================
CREATE OR REPLACE FUNCTION upgrade_user_plan(
    p_user_id UUID,
    p_plan_type VARCHAR(50),
    p_dodo_customer_id VARCHAR(255),
    p_dodo_subscription_id VARCHAR(255),
    p_is_lifetime BOOLEAN DEFAULT FALSE
)
RETURNS VOID AS $$
DECLARE
    v_plan_config RECORD;
BEGIN
    -- Get plan configuration
    SELECT * INTO v_plan_config
    FROM plan_configurations
    WHERE plan_type = p_plan_type;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid plan type: %', p_plan_type;
    END IF;
    
    -- Update or insert user plan
    INSERT INTO user_plans (
        user_id, 
        plan_type, 
        ai_tokens_limit, 
        queries_limit, 
        connections_limit, 
        storage_limit_mb,
        dodo_customer_id,
        dodo_subscription_id,
        is_lifetime,
        read_only_mode,
        billing_cycle_start,
        billing_cycle_end
    ) VALUES (
        p_user_id,
        p_plan_type,
        v_plan_config.ai_tokens_limit,
        v_plan_config.queries_limit,
        v_plan_config.connections_limit,
        v_plan_config.storage_limit_mb,
        p_dodo_customer_id,
        p_dodo_subscription_id,
        p_is_lifetime,
        FALSE,
        CURRENT_TIMESTAMP,
        CASE WHEN p_is_lifetime THEN NULL ELSE CURRENT_TIMESTAMP + INTERVAL '1 month' END
    )
    ON CONFLICT (user_id) DO UPDATE SET
        plan_type = EXCLUDED.plan_type,
        ai_tokens_limit = EXCLUDED.ai_tokens_limit,
        queries_limit = EXCLUDED.queries_limit,
        connections_limit = EXCLUDED.connections_limit,
        storage_limit_mb = EXCLUDED.storage_limit_mb,
        dodo_customer_id = EXCLUDED.dodo_customer_id,
        dodo_subscription_id = EXCLUDED.dodo_subscription_id,
        is_lifetime = EXCLUDED.is_lifetime,
        read_only_mode = FALSE,
        ai_tokens_used = 0,  -- Reset usage on upgrade
        queries_used = 0,
        billing_cycle_start = CURRENT_TIMESTAMP,
        billing_cycle_end = CASE WHEN p_is_lifetime THEN NULL ELSE CURRENT_TIMESTAMP + INTERVAL '1 month' END,
        updated_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Downgrade user to free tier
-- ============================================
CREATE OR REPLACE FUNCTION downgrade_user_to_free(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_plan_config RECORD;
BEGIN
    -- Get free plan configuration
    SELECT * INTO v_plan_config
    FROM plan_configurations
    WHERE plan_type = 'free';
    
    -- Update user plan to free tier
    UPDATE user_plans SET
        plan_type = 'free',
        ai_tokens_limit = v_plan_config.ai_tokens_limit,
        queries_limit = v_plan_config.queries_limit,
        connections_limit = v_plan_config.connections_limit,
        storage_limit_mb = v_plan_config.storage_limit_mb,
        dodo_subscription_id = NULL,
        is_lifetime = FALSE,
        billing_cycle_start = CURRENT_TIMESTAMP,
        billing_cycle_end = CURRENT_TIMESTAMP + INTERVAL '1 month',
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Verify migration completed
-- ============================================
SELECT 'Migration v1 (Payments) completed successfully' as status;

SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('subscriptions', 'payments', 'contact_requests');
