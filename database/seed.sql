-- ============================================
-- ChatSQL Database Seed Data
-- For development and testing purposes
-- ============================================

-- Note: Passwords should be hashed using bcrypt in production
-- The hash below is for password: 'password123'
-- Generated with bcrypt rounds: 10

-- Test User (for development only)
-- INSERT INTO users (email, password_hash, username, is_verified) 
-- VALUES (
--     'test@chatsql.io', 
--     '$2b$10$rQZ5Kg5Kg5Kg5Kg5Kg5KguXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', -- Replace with actual hash
--     'testuser',
--     true
-- );

-- To generate a proper bcrypt hash, use the application's auth service
-- or run: node -e "const bcrypt = require('bcrypt'); bcrypt.hash('password123', 10).then(console.log)"
