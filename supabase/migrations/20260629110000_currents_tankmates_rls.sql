-- Fix: Allow tankmates to read currents with visibility = 'tankmates'
-- Previously, the SELECT policy only allowed public posts and the author's own posts.
-- This adds visibility for 'tankmates' posts to users who follow the author.

-- Drop the old restrictive policy
DROP POLICY IF EXISTS "Public currents readable" ON currents;

-- Create an updated policy that includes tankmates visibility
CREATE POLICY "Currents readable by visibility" 
  ON currents FOR SELECT 
  USING (
    visibility = 'public'
    OR author_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
    OR (
      visibility = 'tankmates'
      AND EXISTS (
        SELECT 1 FROM follows
        WHERE follows.follower_wallet = (current_setting('request.jwt.claims', true)::json->>'wallet_address')
          AND follows.target_wallet = currents.author_wallet
          AND follows.follow_type IN ('tankmate', 'follow')
      )
    )
  );
