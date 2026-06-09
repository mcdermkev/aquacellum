-- ============================================================================
-- Fix: Notification triggers need to bypass RLS when inserting
-- The SECURITY DEFINER functions run as the function owner, but the 
-- dispatch_notification helper needs explicit permission to bypass RLS.
-- ============================================================================

-- Drop and recreate dispatch_notification to explicitly bypass RLS
CREATE OR REPLACE FUNCTION dispatch_notification(
  p_recipient TEXT,
  p_category TEXT,
  p_title TEXT,
  p_body TEXT DEFAULT NULL,
  p_icon TEXT DEFAULT '🔔',
  p_link_type TEXT DEFAULT NULL,
  p_link_id TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
  VALUES (p_recipient, p_category, p_title, p_body, p_icon, p_link_type, p_link_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to the roles that trigger functions run as
GRANT EXECUTE ON FUNCTION dispatch_notification TO postgres, anon, authenticated, service_role;

-- Also ensure the trigger functions have proper search_path
CREATE OR REPLACE FUNCTION notify_on_reaction() RETURNS TRIGGER AS $$
DECLARE
  v_author TEXT;
  v_reactor_name TEXT;
BEGIN
  SELECT author_wallet INTO v_author FROM currents WHERE id = NEW.target_id;
  IF v_author IS NULL OR v_author = NEW.user_wallet THEN RETURN NEW; END IF;
  
  SELECT COALESCE(display_name, LEFT(NEW.user_wallet, 6) || '...' || RIGHT(NEW.user_wallet, 4))
    INTO v_reactor_name FROM profiles WHERE wallet_address = NEW.user_wallet;
  
  PERFORM dispatch_notification(
    v_author,
    'activity',
    v_reactor_name || ' reacted ' || NEW.emoji || ' to your post',
    NULL,
    NEW.emoji,
    'current',
    NEW.target_id::TEXT
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION notify_on_comment() RETURNS TRIGGER AS $$
DECLARE
  v_author TEXT;
  v_parent_author TEXT;
  v_commenter_name TEXT;
BEGIN
  SELECT COALESCE(display_name, LEFT(NEW.author_wallet, 6) || '...' || RIGHT(NEW.author_wallet, 4))
    INTO v_commenter_name FROM profiles WHERE wallet_address = NEW.author_wallet;

  SELECT author_wallet INTO v_author FROM currents WHERE id = NEW.current_id;
  
  IF v_author IS NOT NULL AND v_author != NEW.author_wallet THEN
    PERFORM dispatch_notification(
      v_author,
      'activity',
      v_commenter_name || ' commented on your post',
      LEFT(NEW.body, 100),
      '💬',
      'current',
      NEW.current_id::TEXT
    );
  END IF;
  
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT author_wallet INTO v_parent_author FROM comments WHERE id = NEW.parent_comment_id;
    
    IF v_parent_author IS NOT NULL AND v_parent_author != NEW.author_wallet AND v_parent_author != v_author THEN
      PERFORM dispatch_notification(
        v_parent_author,
        'social',
        v_commenter_name || ' replied to your comment',
        LEFT(NEW.body, 100),
        '↩️',
        'current',
        NEW.current_id::TEXT
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION notify_on_request() RETURNS TRIGGER AS $$
DECLARE
  v_sender_name TEXT;
BEGIN
  SELECT COALESCE(display_name, LEFT(NEW.from_wallet, 6) || '...' || RIGHT(NEW.from_wallet, 4))
    INTO v_sender_name FROM profiles WHERE wallet_address = NEW.from_wallet;
  
  PERFORM dispatch_notification(
    NEW.to_wallet,
    'social',
    v_sender_name || ' wants to be your Tankmate',
    NEW.message,
    '🤝',
    'profile',
    NEW.from_wallet
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION notify_on_request_accepted() RETURNS TRIGGER AS $$
DECLARE
  v_accepter_name TEXT;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT COALESCE(display_name, LEFT(NEW.to_wallet, 6) || '...' || RIGHT(NEW.to_wallet, 4))
      INTO v_accepter_name FROM profiles WHERE wallet_address = NEW.to_wallet;
    
    PERFORM dispatch_notification(
      NEW.from_wallet,
      'social',
      v_accepter_name || ' accepted your Tankmate request!',
      NULL,
      '✅',
      'profile',
      NEW.to_wallet
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
