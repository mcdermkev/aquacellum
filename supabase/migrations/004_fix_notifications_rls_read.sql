-- ============================================================================
-- Fix: Allow reading all notifications in dev mode + ensure triggers can
-- read from other tables when executing
-- ============================================================================

-- Allow anon to read all notifications (dev only)
CREATE POLICY "dev_notifications_read" ON sonar_notifications FOR SELECT USING (true);

-- The trigger functions use SECURITY DEFINER which should bypass RLS,
-- but let's also ensure they explicitly set the role when running.
-- Recreate with explicit role setting:

CREATE OR REPLACE FUNCTION notify_on_reaction() RETURNS TRIGGER AS $$
DECLARE
  v_author TEXT;
  v_reactor_name TEXT;
BEGIN
  -- Direct table access (bypasses RLS due to SECURITY DEFINER)
  SELECT author_wallet INTO v_author FROM public.currents WHERE id = NEW.target_id;
  IF v_author IS NULL OR v_author = NEW.user_wallet THEN RETURN NEW; END IF;
  
  SELECT COALESCE(display_name, LEFT(NEW.user_wallet, 6) || '...' || RIGHT(NEW.user_wallet, 4))
    INTO v_reactor_name FROM public.profiles WHERE wallet_address = NEW.user_wallet;
  
  INSERT INTO public.sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
  VALUES (
    v_author,
    'activity',
    COALESCE(v_reactor_name, 'Someone') || ' reacted ' || NEW.emoji || ' to your post',
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
    INTO v_commenter_name FROM public.profiles WHERE wallet_address = NEW.author_wallet;

  SELECT author_wallet INTO v_author FROM public.currents WHERE id = NEW.current_id;
  
  IF v_author IS NOT NULL AND v_author != NEW.author_wallet THEN
    INSERT INTO public.sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      v_author,
      'activity',
      COALESCE(v_commenter_name, 'Someone') || ' commented on your post',
      LEFT(NEW.body, 100),
      '💬',
      'current',
      NEW.current_id::TEXT
    );
  END IF;
  
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT author_wallet INTO v_parent_author FROM public.comments WHERE id = NEW.parent_comment_id;
    
    IF v_parent_author IS NOT NULL AND v_parent_author != NEW.author_wallet AND v_parent_author != v_author THEN
      INSERT INTO public.sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
      VALUES (
        v_parent_author,
        'social',
        COALESCE(v_commenter_name, 'Someone') || ' replied to your comment',
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
    INTO v_sender_name FROM public.profiles WHERE wallet_address = NEW.from_wallet;
  
  INSERT INTO public.sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
  VALUES (
    NEW.to_wallet,
    'social',
    COALESCE(v_sender_name, 'Someone') || ' wants to be your Tankmate',
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
      INTO v_accepter_name FROM public.profiles WHERE wallet_address = NEW.to_wallet;
    
    INSERT INTO public.sonar_notifications (recipient_wallet, category, title, body, icon, link_type, link_id)
    VALUES (
      NEW.from_wallet,
      'social',
      COALESCE(v_accepter_name, 'Someone') || ' accepted your Tankmate request!',
      NULL,
      '✅',
      'profile',
      NEW.to_wallet
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
